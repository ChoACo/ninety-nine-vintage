begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

alter table public.member_accounts
  add column if not exists last_depositor_name text
  check (
    last_depositor_name is null
    or char_length(btrim(last_depositor_name)) between 1 and 80
  );

comment on column public.member_accounts.last_depositor_name
  is 'Member-editable payer name remembered for the next combined auction transfer dialog.';

create or replace function public.begin_my_combined_auction_payment(
  p_depositor_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := btrim(coalesce(p_depositor_name, ''));
  v_win record;
  v_transfer record;
  v_item_count integer := 0;
  v_expected bigint := 0;
  v_due_at timestamptz;
  v_bank_name text;
  v_account_number text;
  v_requested_at timestamptz;
  v_items jsonb := '[]'::jsonb;
begin
  if v_actor is null or not public.is_member() then
    raise exception using errcode = '42501', message = '회원 로그인이 필요합니다.';
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception using errcode = '22023', message = '입금자명을 1~80자로 입력해 주세요.';
  end if;

  perform settings.singleton
  from public.payment_runtime_settings as settings
  where settings.singleton
    and settings.active_mode = 'manual_transfer'
  for share;
  if not found then
    raise exception using errcode = '55000', message = '현재 계좌이체 결제를 이용할 수 없습니다.';
  end if;

  perform 1
  from public.member_accounts as accounts
  where accounts.member_id = v_actor
    and accounts.account_status = 'active'
  for update;
  if not found then
    raise exception using errcode = '42501', message = '결제할 수 있는 활성 회원이 아닙니다.';
  end if;

  -- The existing per-product RPC remains the single eligibility/deadline
  -- authority. Calling it for every payable win inside this function keeps
  -- creation atomic while the member sees only one combined payment.
  for v_win in
    select wins.product_id
    from public.get_my_won_products() as wins
    where not wins.is_payment_settled
      and (
        wins.payment_due_at is null
        or wins.payment_due_at > clock_timestamp()
        or public.is_payment_deadline_exempt(v_actor)
      )
    order by wins.product_id
  loop
    select *
    into v_transfer
    from public.begin_manual_transfer(v_win.product_id);
  end loop;

  select
    count(*)::integer,
    coalesce(sum(orders.expected_amount), 0)::bigint,
    min(coalesce(orders.display_due_at, orders.due_at)),
    min(orders.bank_name_snapshot),
    min(orders.account_number_snapshot),
    min(orders.requested_at),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'orderId', orders.id,
          'productId', orders.product_id,
          'title', orders.order_name,
          'amount', orders.expected_amount,
          'dueAt', coalesce(orders.display_due_at, orders.due_at)
        )
        order by orders.requested_at, orders.id
      ),
      '[]'::jsonb
    )
  into
    v_item_count,
    v_expected,
    v_due_at,
    v_bank_name,
    v_account_number,
    v_requested_at,
    v_items
  from public.manual_transfer_orders as orders
  where orders.buyer_id = v_actor
    and orders.status = 'awaiting_manual_transfer';

  if v_item_count = 0 then
    raise exception using errcode = 'P0002', message = '결제할 낙찰품이 없습니다.';
  end if;
  if v_expected < 1 or v_bank_name is null or v_account_number is null then
    raise exception using errcode = '55000', message = '일괄 결제 정보를 확정할 수 없습니다.';
  end if;

  update public.member_accounts
  set last_depositor_name = v_name
  where member_id = v_actor;

  return jsonb_build_object(
    'paymentId', v_actor,
    'depositorName', v_name,
    'expectedAmount', v_expected,
    'itemCount', v_item_count,
    'bankName', v_bank_name,
    'accountNumber', v_account_number,
    'requestedAt', v_requested_at,
    'dueAt', v_due_at,
    'items', v_items
  );
end;
$$;

revoke all on function public.begin_my_combined_auction_payment(text)
from public, anon, authenticated, service_role;
grant execute on function public.begin_my_combined_auction_payment(text)
to authenticated;

create or replace function public.confirm_combined_auction_payment(
  p_member_id uuid,
  p_expected_version bigint,
  p_depositor_name text,
  p_observed_received_amount bigint,
  p_observed_ledger_entry_count integer,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_name text := btrim(coalesce(p_depositor_name, ''));
  v_fingerprint text;
  v_receipt public.inventory_command_receipts%rowtype;
  v_order record;
  v_offer public.auction_purchase_offers%rowtype;
  v_expected bigint;
  v_received bigint;
  v_count integer;
  v_version bigint;
  v_child_hash text;
  v_child_key uuid;
  v_order_received bigint;
  v_result jsonb;
begin
  if v_actor is null or not public.is_staff() then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;
  if p_member_id is null
    or p_idempotency_key is null
    or char_length(v_name) not between 1 and 80
    or p_expected_version is null
    or p_expected_version < 0
    or p_observed_received_amount is null
    or p_observed_received_amount < 0
    or p_observed_ledger_entry_count is null
    or p_observed_ledger_entry_count < 0
  then
    raise exception using errcode = '22023', message = '입금 확인 내용을 확인해 주세요.';
  end if;

  v_fingerprint := app_private.inventory_v2_fingerprint(
    jsonb_build_object(
      'kind', 'auction',
      'member', p_member_id,
      'version', p_expected_version,
      'received', p_observed_received_amount,
      'count', p_observed_ledger_entry_count,
      'depositor', v_name
    )
  );

  select *
  into v_receipt
  from public.inventory_command_receipts
  where actor_user_id = v_actor
    and idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.command_name <> 'confirm_payment'
      or v_receipt.request_fingerprint <> v_fingerprint
    then
      raise exception using errcode = '23505', message = '동일한 요청 키를 다른 입금 확인에 재사용할 수 없습니다.';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay', true);
  end if;

  perform settings.singleton
  from public.payment_runtime_settings as settings
  where settings.singleton
    and settings.active_mode = 'manual_transfer'
  for update;
  if not found then
    raise exception using errcode = 'PT409', message = '수동 계좌이체 모드에서만 입금을 확인할 수 있습니다.';
  end if;

  perform accounts.member_id
  from public.member_accounts as accounts
  where accounts.member_id = p_member_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '입금 회원을 찾지 못했습니다.';
  end if;

  -- Lock all child aggregates in deterministic order before validation.
  perform products.id
  from public.products as products
  join public.manual_transfer_orders as orders on orders.product_id = products.id
  where orders.buyer_id = p_member_id
    and orders.status = 'awaiting_manual_transfer'
  order by products.id
  for update of products;

  perform offers.id
  from public.auction_purchase_offers as offers
  join public.manual_transfer_orders as orders on orders.purchase_offer_id = offers.id
  where orders.buyer_id = p_member_id
    and orders.status = 'awaiting_manual_transfer'
  order by offers.id
  for update of offers;

  perform orders.id
  from public.manual_transfer_orders as orders
  where orders.buyer_id = p_member_id
    and orders.status = 'awaiting_manual_transfer'
  order by orders.id
  for update;

  perform payment_orders.id
  from public.payment_orders as payment_orders
  join public.manual_transfer_orders as orders on orders.product_id = payment_orders.product_id
  where orders.buyer_id = p_member_id
    and orders.status = 'awaiting_manual_transfer'
  order by payment_orders.id
  for update of payment_orders;

  select
    coalesce(sum(orders.expected_amount), 0)::bigint,
    coalesce(sum(ledger.received), 0)::bigint,
    coalesce(sum(ledger.entries), 0)::integer,
    coalesce(sum(orders.version + 1), 0)::bigint
  into v_expected, v_received, v_count, v_version
  from public.manual_transfer_orders as orders
  cross join lateral (
    select
      coalesce(sum(
        case when entries.entry_type = 'receipt'
          then entries.amount else -entries.amount end
      ), 0)::bigint as received,
      count(entries.id)::integer as entries
    from public.manual_transfer_payment_ledger as entries
    where entries.manual_transfer_order_id = orders.id
  ) as ledger
  where orders.buyer_id = p_member_id
    and orders.status = 'awaiting_manual_transfer';

  if v_expected = 0 then
    raise exception using errcode = 'P0002', message = '입금 대기 중인 낙찰품이 없습니다.';
  end if;
  if v_version is distinct from p_expected_version
    or v_received is distinct from p_observed_received_amount
    or v_count is distinct from p_observed_ledger_entry_count
  then
    raise exception using errcode = 'PT409', message = '입금 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
  end if;
  if v_received < 0 or v_received >= v_expected then
    raise exception using errcode = '22023', message = '표시된 낙찰품 잔액 전체만 확인할 수 있습니다.';
  end if;
  if exists (
    select 1
    from public.manual_transfer_orders as orders
    join public.products as products on products.id = orders.product_id
    join public.stores as stores on stores.id = products.store_id
    where orders.buyer_id = p_member_id
      and orders.status = 'awaiting_manual_transfer'
      and not app_private.can_confirm_shared_payment(stores.business_id)
  ) then
    raise exception using errcode = '42501', message = '모든 낙찰품의 입금을 확인할 권한이 없습니다.';
  end if;

  for v_order in
    select orders.*, products.status as product_status
    from public.manual_transfer_orders as orders
    join public.products as products on products.id = orders.product_id
    where orders.buyer_id = p_member_id
      and orders.status = 'awaiting_manual_transfer'
    order by orders.id
  loop
    if v_order.product_status <> 'closed' then
      raise exception using errcode = '55000', message = '마감된 경매 상품만 입금 확정할 수 있습니다.';
    end if;
    if v_order.due_at is not null and v_now >= v_order.due_at then
      raise exception using errcode = '55000', message = '입금 기한이 지난 낙찰품이 포함되어 있습니다.';
    end if;
    if exists (
      select 1
      from public.payment_orders as payment_orders
      where payment_orders.product_id = v_order.product_id
        and payment_orders.payment_status = '결제완료'
        and payment_orders.portone_status = 'PAID'
    ) then
      raise exception using errcode = '55000', message = '이미 PG 결제가 끝난 상품이 포함되어 있습니다.';
    end if;

    if v_order.purchase_offer_id is not null then
      select *
      into v_offer
      from public.auction_purchase_offers
      where id = v_order.purchase_offer_id;
      if v_offer.id is null
        or v_offer.product_id <> v_order.product_id
        or v_offer.bidder_id is distinct from p_member_id
        or v_offer.offered_amount <> v_order.expected_amount
        or v_offer.status not in ('accepted', 'payment_due')
        or (v_offer.payment_due_at is not null and v_now >= v_offer.payment_due_at)
      then
        raise exception using errcode = '55000', message = '현재 구매 제안과 입금 대상이 일치하지 않습니다.';
      end if;
    elsif not exists (
      select 1
      from public.auction_bids as bids
      where bids.product_id = v_order.product_id
        and bids.bidder_id = p_member_id
        and bids.amount = v_order.expected_amount
        and bids.id = (
          select ranked.id
          from public.auction_bids as ranked
          where ranked.product_id = v_order.product_id
          order by ranked.amount desc, ranked.created_at desc, ranked.id desc
          limit 1
        )
    ) then
      raise exception using errcode = '55000', message = '낙찰자 또는 입금 금액 검증에 실패했습니다.';
    end if;

    if not public.is_owner()
      and public.is_owner_hidden_test_member(p_member_id)
    then
      raise exception using errcode = '42501', message = '확인할 수 없는 테스트 입금 주문입니다.';
    end if;

    select coalesce(sum(
      case when entries.entry_type = 'receipt'
        then entries.amount else -entries.amount end
    ), 0)::bigint
    into v_order_received
    from public.manual_transfer_payment_ledger as entries
    where entries.manual_transfer_order_id = v_order.id;
    if v_order_received < 0 or v_order_received >= v_order.expected_amount then
      raise exception using errcode = '22023', message = '낙찰품별 입금 원장 잔액을 확인해 주세요.';
    end if;

    v_child_hash := md5(p_idempotency_key::text || ':' || v_order.id::text);
    v_child_key := (
      substr(v_child_hash, 1, 8) || '-' ||
      substr(v_child_hash, 9, 4) || '-4' ||
      substr(v_child_hash, 14, 3) || '-a' ||
      substr(v_child_hash, 18, 3) || '-' ||
      substr(v_child_hash, 21, 12)
    )::uuid;

    insert into public.manual_transfer_payment_ledger (
      transfer_kind,
      manual_transfer_order_id,
      entry_type,
      amount,
      depositor_name,
      memo,
      recorded_by,
      idempotency_key
    ) values (
      'auction',
      v_order.id,
      'receipt',
      v_order.expected_amount - v_order_received,
      v_name,
      '',
      v_actor,
      v_child_key::text
    );

    update public.manual_transfer_orders
    set
      status = 'confirmed',
      confirmed_at = v_now,
      confirmed_by = v_actor
    where id = v_order.id
      and status = 'awaiting_manual_transfer';
    if not found then
      raise exception using errcode = 'PT409', message = '다른 운영자가 낙찰 입금을 처리했습니다.';
    end if;
  end loop;

  v_count := v_count + (
    select count(*)::integer
    from public.manual_transfer_orders
    where buyer_id = p_member_id
      and status = 'confirmed'
      and confirmed_at = v_now
      and confirmed_by = v_actor
  );
  v_result := jsonb_build_object(
    'payment_kind', 'auction',
    'payment_id', p_member_id,
    'version', v_version,
    'received_amount', v_expected,
    'remaining_amount', 0,
    'ledger_entry_count', v_count,
    'status', 'confirmed',
    'idempotent_replay', false
  );

  insert into public.inventory_command_receipts (
    actor_user_id,
    idempotency_key,
    command_name,
    target_id,
    request_fingerprint,
    result,
    created_at
  ) values (
    v_actor,
    p_idempotency_key,
    'confirm_payment',
    p_member_id,
    v_fingerprint,
    v_result,
    v_now
  );
  return v_result;
end;
$$;

revoke all on function
  public.confirm_combined_auction_payment(uuid,bigint,text,bigint,integer,uuid)
from public, anon, authenticated, service_role;
grant execute on function
  public.confirm_combined_auction_payment(uuid,bigint,text,bigint,integer,uuid)
to authenticated;

create or replace function public.get_unified_manual_payment_queue(
  p_include_history boolean default false,
  p_limit integer default 200,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
select case
  when auth.uid() is null or not public.is_staff()
    then jsonb_build_object('payments', '[]'::jsonb, 'serverTime', clock_timestamp())
  else jsonb_build_object(
    'payments',
    coalesce((
      select jsonb_agg(to_jsonb(queue) order by queue."requestedAt", queue."paymentId")
      from (
        select *
        from (
          select
            'commerce'::text as "paymentKind",
            transfers.id as "paymentId",
            scope.business_id as "businessId",
            orders.member_id as "memberId",
            transfers.order_id::text as reference,
            transfers.expected_amount as "expectedAmount",
            ledger.received as "receivedAmount",
            transfers.expected_amount - ledger.received as "remainingAmount",
            ledger.entries as "ledgerEntryCount",
            transfers.status,
            transfers.version,
            transfers.bank_name_snapshot as "bankNameSnapshot",
            transfers.account_number_snapshot as "accountNumberSnapshot",
            transfers.requested_at as "requestedAt",
            transfers.confirmed_at as "confirmedAt",
            transfers.confirmed_by as "confirmedBy",
            ledger.last_depositor as "lastDepositorName"
          from public.commerce_order_transfers as transfers
          join public.commerce_orders as orders on orders.id = transfers.order_id
          cross join lateral (
            select
              (array_agg(distinct stores.business_id))[1] as business_id,
              count(distinct stores.business_id) as business_count
            from public.commerce_order_items as items
            join public.stores as stores on stores.id = items.store_id
            where items.order_id = transfers.order_id
          ) as scope
          cross join lateral (
            select
              coalesce(sum(case when entries.entry_type = 'receipt' then entries.amount else -entries.amount end), 0)::bigint as received,
              count(entries.id)::integer as entries,
              (array_agg(entries.depositor_name order by entries.created_at desc, entries.id desc)
                filter (where entries.entry_type = 'receipt'))[1] as last_depositor
            from public.manual_transfer_payment_ledger as entries
            where entries.commerce_order_transfer_id = transfers.id
          ) as ledger
          where scope.business_count = 1
            and (p_include_history or transfers.status in ('awaiting_transfer', 'partially_paid'))
            and app_private.can_confirm_shared_payment(scope.business_id)

          union all

          select
            'auction'::text,
            batches.member_id,
            batches.business_id,
            batches.member_id,
            batches.reference,
            batches.expected_amount,
            batches.received_amount,
            batches.expected_amount - batches.received_amount,
            batches.ledger_entry_count,
            'awaiting_manual_transfer'::text,
            batches.version,
            batches.bank_name_snapshot,
            batches.account_number_snapshot,
            batches.requested_at,
            null::timestamptz,
            null::uuid,
            coalesce(accounts.last_depositor_name, batches.last_depositor)
          from (
            select
              manual_orders.buyer_id as member_id,
              min(stores.business_id::text)::uuid as business_id,
              string_agg(manual_orders.order_name, ', ' order by manual_orders.requested_at, manual_orders.id) as reference,
              sum(manual_orders.expected_amount)::bigint as expected_amount,
              sum(ledger.received)::bigint as received_amount,
              sum(ledger.entries)::integer as ledger_entry_count,
              sum(manual_orders.version + 1)::bigint as version,
              min(manual_orders.bank_name_snapshot) as bank_name_snapshot,
              min(manual_orders.account_number_snapshot) as account_number_snapshot,
              min(manual_orders.requested_at) as requested_at,
              (array_agg(ledger.last_depositor order by ledger.last_entry_at desc nulls last)
                filter (where ledger.last_depositor is not null))[1] as last_depositor,
              bool_and(app_private.can_confirm_shared_payment(stores.business_id)) as can_confirm
            from public.manual_transfer_orders as manual_orders
            join public.products as products on products.id = manual_orders.product_id
            join public.stores as stores on stores.id = products.store_id
            cross join lateral (
              select
                coalesce(sum(case when entries.entry_type = 'receipt' then entries.amount else -entries.amount end), 0)::bigint as received,
                count(entries.id)::integer as entries,
                (array_agg(entries.depositor_name order by entries.created_at desc, entries.id desc)
                  filter (where entries.entry_type = 'receipt'))[1] as last_depositor,
                max(entries.created_at) as last_entry_at
              from public.manual_transfer_payment_ledger as entries
              where entries.manual_transfer_order_id = manual_orders.id
            ) as ledger
            where manual_orders.status = 'awaiting_manual_transfer'
              and manual_orders.buyer_id is not null
            group by manual_orders.buyer_id
          ) as batches
          join public.member_accounts as accounts on accounts.member_id = batches.member_id
          where batches.can_confirm

          union all

          select
            'auction'::text,
            manual_orders.id,
            stores.business_id,
            manual_orders.buyer_id,
            manual_orders.order_name,
            manual_orders.expected_amount,
            ledger.received,
            manual_orders.expected_amount - ledger.received,
            ledger.entries,
            manual_orders.status,
            manual_orders.version,
            manual_orders.bank_name_snapshot,
            manual_orders.account_number_snapshot,
            manual_orders.requested_at,
            manual_orders.confirmed_at,
            manual_orders.confirmed_by,
            ledger.last_depositor
          from public.manual_transfer_orders as manual_orders
          join public.products as products on products.id = manual_orders.product_id
          join public.stores as stores on stores.id = products.store_id
          cross join lateral (
            select
              coalesce(sum(case when entries.entry_type = 'receipt' then entries.amount else -entries.amount end), 0)::bigint as received,
              count(entries.id)::integer as entries,
              (array_agg(entries.depositor_name order by entries.created_at desc, entries.id desc)
                filter (where entries.entry_type = 'receipt'))[1] as last_depositor
            from public.manual_transfer_payment_ledger as entries
            where entries.manual_transfer_order_id = manual_orders.id
          ) as ledger
          where p_include_history
            and manual_orders.status = 'confirmed'
            and app_private.can_confirm_shared_payment(stores.business_id)

          union all

          select
            'shipping_fee'::text,
            payments.id,
            payments.business_id,
            payments.member_id,
            '배송비'::text,
            payments.expected_amount,
            ledger.received,
            payments.expected_amount - ledger.received,
            ledger.entries,
            payments.status,
            payments.version,
            payments.bank_name_snapshot,
            payments.account_number_snapshot,
            payments.requested_at,
            payments.confirmed_at,
            payments.confirmed_by,
            ledger.last_depositor
          from public.shipping_fee_payments as payments
          cross join lateral (
            select
              coalesce(sum(case when entries.entry_type = 'receipt' then entries.amount else -entries.amount end), 0)::bigint as received,
              count(entries.id)::integer as entries,
              (array_agg(entries.depositor_name order by entries.created_at desc, entries.id desc)
                filter (where entries.entry_type = 'receipt'))[1] as last_depositor
            from public.manual_transfer_payment_ledger as entries
            where entries.shipping_fee_payment_id = payments.id
          ) as ledger
          where payments.inventory_shipment_id is not null
            and (p_include_history or payments.status in ('awaiting_transfer', 'partially_paid'))
            and app_private.can_confirm_shared_payment(payments.business_id)
        ) as unified
        order by "requestedAt", "paymentId"
        limit greatest(1, least(coalesce(p_limit, 200), 500))
        offset greatest(coalesce(p_offset, 0), 0)
      ) as queue
    ), '[]'::jsonb),
    'serverTime',
    clock_timestamp()
  )
end;
$$;

revoke all on function public.get_unified_manual_payment_queue(boolean,integer,integer)
from public, anon, authenticated, service_role;
grant execute on function public.get_unified_manual_payment_queue(boolean,integer,integer)
to authenticated;

create or replace function public.confirm_unified_manual_payment_v2(
  p_payment_kind text,
  p_payment_id uuid,
  p_expected_version bigint,
  p_depositor_name text,
  p_observed_received_amount bigint,
  p_observed_ledger_entry_count integer,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected bigint;
begin
  if p_payment_kind = 'auction' then
    return public.confirm_combined_auction_payment(
      p_payment_id,
      p_expected_version,
      p_depositor_name,
      p_observed_received_amount,
      p_observed_ledger_entry_count,
      p_idempotency_key
    );
  end if;
  if p_payment_kind = 'shipping_fee' then
    select expected_amount into v_expected
    from public.shipping_fee_payments
    where id = p_payment_id and inventory_shipment_id is not null;
    if v_expected is not null and p_observed_received_amount = v_expected then
      return public.finalize_inventory_shipping_fee_payment(
        p_payment_id,
        p_observed_received_amount,
        p_observed_ledger_entry_count,
        p_expected_version,
        p_idempotency_key
      );
    end if;
  end if;
  return public.confirm_unified_manual_payment(
    p_payment_kind,
    p_payment_id,
    p_expected_version,
    p_depositor_name,
    p_observed_received_amount,
    p_observed_ledger_entry_count,
    p_idempotency_key
  );
end;
$$;

revoke all on function
  public.confirm_unified_manual_payment_v2(text,uuid,bigint,text,bigint,integer,uuid)
from public, anon, authenticated, service_role;
grant execute on function
  public.confirm_unified_manual_payment_v2(text,uuid,bigint,text,bigint,integer,uuid)
to authenticated;

comment on function public.confirm_unified_manual_payment_v2(text,uuid,bigint,text,bigint,integer,uuid)
  is 'Confirms every pending auction win for one member atomically; routes other payment kinds through their existing exact-balance paths.';

commit;
