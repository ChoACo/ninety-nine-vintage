begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

alter table public.shipping_fee_payments
  add column credit_quantity integer not null default 1,
  add column payment_context text not null default 'shipping_credit';

alter table public.shipping_fee_payments
  add constraint shipping_fee_payments_credit_quantity_check
    check (credit_quantity between 1 and 100),
  add constraint shipping_fee_payments_context_check
    check (payment_context in ('shipping_credit', 'auction_bundle', 'shipment')),
  add constraint shipping_fee_payments_shipment_quantity_check
    check (
      (shipping_request_id is null and inventory_shipment_id is null)
      or credit_quantity = 1
    );

update public.shipping_fee_payments
set payment_context = 'shipment'
where shipping_request_id is not null or inventory_shipment_id is not null;

create unique index shipping_fee_payments_one_pending_auction_bundle_idx
  on public.shipping_fee_payments (member_id)
  where payment_context = 'auction_bundle'
    and status in ('awaiting_transfer', 'partially_paid');

comment on column public.shipping_fee_payments.credit_quantity
  is 'Number of prepaid shipping credits granted when a standalone or auction-bundle payment is confirmed.';
comment on column public.shipping_fee_payments.payment_context
  is 'shipping_credit: standalone prepaid credits, auction_bundle: fee included with all pending wins, shipment: fee attached to a shipment.';

grant select on table public.inventory_fulfillment_rollout_settings
to service_role;

alter function public.begin_my_combined_auction_payment(text)
  rename to begin_my_combined_auction_items;

revoke all on function public.begin_my_combined_auction_items(text)
from public, anon, authenticated, service_role;

create function public.begin_my_combined_auction_payment(
  p_depositor_name text,
  p_include_shipping_fee boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_items jsonb;
  v_bundle public.shipping_fee_payments%rowtype;
  v_shipping_fee bigint := 0;
  v_credit_quantity integer := 0;
  v_bank_name text;
  v_account_number text;
  v_bundle_key text;
begin
  if v_actor is null or not public.is_member() then
    raise exception using errcode = '42501', message = '회원 로그인이 필요합니다.';
  end if;
  if p_include_shipping_fee is null then
    raise exception using errcode = '22023', message = '택배비 포함 여부를 확인해 주세요.';
  end if;

  v_items := public.begin_my_combined_auction_items(p_depositor_name);

  select
    count(*)::integer,
    coalesce(sum(fees.shipping_fee_amount), 0)::bigint
  into v_credit_quantity, v_shipping_fee
  from (
    select distinct
      stores.business_id,
      settings.shipping_fee_amount
    from public.manual_transfer_orders as orders
    join public.products as products on products.id = orders.product_id
    join public.stores as stores on stores.id = products.store_id
    join public.inventory_fulfillment_rollout_settings as settings
      on settings.business_id = stores.business_id
    where orders.buyer_id = v_actor
      and orders.status = 'awaiting_manual_transfer'
  ) as fees;

  if v_credit_quantity < 1 or v_shipping_fee < 1 then
    raise exception using errcode = '55000', message = '설정된 택배비를 확인할 수 없습니다.';
  end if;

  select btrim(settings.bank_name), btrim(settings.account_number)
  into v_bank_name, v_account_number
  from public.payment_runtime_settings as settings
  where settings.singleton
    and settings.active_mode = 'manual_transfer';
  if v_bank_name is null or v_account_number is null then
    raise exception using errcode = '55000', message = '입금 계좌가 설정되지 않았습니다.';
  end if;

  select payments.*
  into v_bundle
  from public.shipping_fee_payments as payments
  where payments.member_id = v_actor
    and payments.payment_context = 'auction_bundle'
    and payments.status in ('awaiting_transfer', 'partially_paid')
  for update;

  if p_include_shipping_fee then
    if v_bundle.id is not null and v_bundle.status = 'partially_paid' and (
      v_bundle.expected_amount <> v_shipping_fee
      or v_bundle.credit_quantity <> v_credit_quantity
    ) then
      raise exception using
        errcode = 'PT409',
        message = '일부 입금된 택배비가 있어 결제 구성을 변경할 수 없습니다.';
    end if;

    select 'auction-bundle:' || md5(string_agg(orders.id::text, ',' order by orders.id))
    into v_bundle_key
    from public.manual_transfer_orders as orders
    where orders.buyer_id = v_actor
      and orders.status = 'awaiting_manual_transfer';

    if v_bundle.id is null then
      insert into public.shipping_fee_payments (
        member_id,
        expected_amount,
        bank_name_snapshot,
        account_number_snapshot,
        idempotency_key,
        credit_quantity,
        payment_context
      ) values (
        v_actor,
        v_shipping_fee,
        v_bank_name,
        v_account_number,
        v_bundle_key,
        v_credit_quantity,
        'auction_bundle'
      )
      returning * into v_bundle;
    elsif v_bundle.status = 'awaiting_transfer' then
      update public.shipping_fee_payments
      set
        expected_amount = v_shipping_fee,
        bank_name_snapshot = v_bank_name,
        account_number_snapshot = v_account_number,
        idempotency_key = v_bundle_key,
        credit_quantity = v_credit_quantity
      where id = v_bundle.id
      returning * into v_bundle;
    end if;
  elsif v_bundle.id is not null then
    if v_bundle.status = 'partially_paid' then
      raise exception using
        errcode = 'PT409',
        message = '일부 입금된 택배비는 결제에서 제외할 수 없습니다.';
    end if;
    update public.shipping_fee_payments
    set status = 'cancelled'
    where id = v_bundle.id and status = 'awaiting_transfer';
    v_shipping_fee := 0;
    v_credit_quantity := 0;
    v_bundle := null;
  else
    v_shipping_fee := 0;
    v_credit_quantity := 0;
  end if;

  return v_items || jsonb_build_object(
    'itemSubtotal', (v_items ->> 'expectedAmount')::bigint,
    'shippingFee', v_shipping_fee,
    'shippingCreditQuantity', v_credit_quantity,
    'includeShippingFee', p_include_shipping_fee,
    'expectedAmount', (v_items ->> 'expectedAmount')::bigint + v_shipping_fee
  );
end;
$$;

revoke all on function public.begin_my_combined_auction_payment(text,boolean)
from public, anon, authenticated, service_role;
grant execute on function public.begin_my_combined_auction_payment(text,boolean)
to authenticated;

alter function public.confirm_combined_auction_payment(
  uuid,bigint,text,bigint,integer,uuid
)
rename to confirm_combined_auction_items;

revoke all on function public.confirm_combined_auction_items(
  uuid,bigint,text,bigint,integer,uuid
)
from public, anon, authenticated, service_role;

create function public.confirm_combined_auction_payment(
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
  v_bundle public.shipping_fee_payments%rowtype;
  v_result jsonb;
  v_child_hash text;
  v_child_key text;
  v_credit_count integer;
begin
  if v_actor is null or not public.is_staff() then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;

  select payments.*
  into v_bundle
  from public.shipping_fee_payments as payments
  where payments.member_id = p_member_id
    and payments.payment_context = 'auction_bundle'
    and payments.status in ('awaiting_transfer', 'partially_paid')
  for update;

  v_result := public.confirm_combined_auction_items(
    p_member_id,
    p_expected_version,
    p_depositor_name,
    p_observed_received_amount,
    p_observed_ledger_entry_count,
    p_idempotency_key
  );

  if coalesce((v_result ->> 'idempotent_replay')::boolean, false) then
    return v_result;
  end if;

  if v_bundle.id is not null then
    if v_bundle.status <> 'awaiting_transfer' then
      raise exception using
        errcode = 'PT409',
        message = '택배비 입금 상태가 변경되었습니다. 새로고침 후 다시 확인해 주세요.';
    end if;
    v_child_hash := md5(p_idempotency_key::text || ':shipping:' || v_bundle.id::text);
    v_child_key := (
      substr(v_child_hash, 1, 8) || '-' ||
      substr(v_child_hash, 9, 4) || '-4' ||
      substr(v_child_hash, 14, 3) || '-a' ||
      substr(v_child_hash, 18, 3) || '-' ||
      substr(v_child_hash, 21, 12)
    );

    insert into public.manual_transfer_payment_ledger (
      transfer_kind,
      shipping_fee_payment_id,
      entry_type,
      amount,
      depositor_name,
      memo,
      recorded_by,
      idempotency_key
    ) values (
      'shipping',
      v_bundle.id,
      'receipt',
      v_bundle.expected_amount,
      btrim(p_depositor_name),
      '낙찰품 일괄결제 택배비',
      v_actor,
      v_child_key
    );

    update public.member_accounts
    set shipping_credit_count = shipping_credit_count + v_bundle.credit_quantity
    where member_id = p_member_id
      and shipping_credit_count + v_bundle.credit_quantity <= 10000
    returning shipping_credit_count into v_credit_count;
    if v_credit_count is null then
      raise exception using errcode = '22003', message = '배송 크레딧 한도에 도달했습니다.';
    end if;

    insert into public.shipping_credit_ledger (
      member_id,
      delta,
      reason,
      created_by
    ) values (
      p_member_id,
      v_bundle.credit_quantity,
      'prepaid',
      v_actor
    );

    update public.shipping_fee_payments
    set
      status = 'confirmed',
      confirmed_at = clock_timestamp(),
      confirmed_by = v_actor
    where id = v_bundle.id
      and status = 'awaiting_transfer';
    if not found then
      raise exception using errcode = 'PT409', message = '다른 운영자가 택배비 입금을 처리했습니다.';
    end if;

    v_result := v_result || jsonb_build_object(
      'received_amount',
      (v_result ->> 'received_amount')::bigint + v_bundle.expected_amount,
      'shipping_fee_amount',
      v_bundle.expected_amount,
      'shipping_credit_quantity',
      v_bundle.credit_quantity,
      'shipping_payment_id',
      v_bundle.id
    );

    update public.inventory_command_receipts
    set result = v_result
    where actor_user_id = v_actor
      and idempotency_key = p_idempotency_key;
  end if;

  return v_result;
end;
$$;

revoke all on function public.confirm_combined_auction_payment(
  uuid,bigint,text,bigint,integer,uuid
)
from public, anon, authenticated, service_role;
grant execute on function public.confirm_combined_auction_payment(
  uuid,bigint,text,bigint,integer,uuid
)
to authenticated;

alter function public.get_unified_manual_payment_queue(boolean,integer,integer)
  rename to get_unified_manual_payment_queue_base;

revoke all on function public.get_unified_manual_payment_queue_base(
  boolean,integer,integer
)
from public, anon, authenticated, service_role;

create function public.get_unified_manual_payment_queue(
  p_include_history boolean default false,
  p_limit integer default 200,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base jsonb;
  v_payments jsonb;
begin
  v_base := public.get_unified_manual_payment_queue_base(
    p_include_history,
    p_limit,
    p_offset
  );

  select coalesce(
    jsonb_agg(
      case
        when payment ->> 'paymentKind' = 'auction'
          and payment ->> 'paymentId' = payment ->> 'memberId'
          and payment ->> 'status' = 'awaiting_manual_transfer'
        then payment || jsonb_build_object(
          'expectedAmount',
          (payment ->> 'expectedAmount')::bigint + coalesce(bundle.expected_amount, 0),
          'remainingAmount',
          (payment ->> 'remainingAmount')::bigint + coalesce(bundle.expected_amount, 0)
        )
        else payment
      end
      order by payment ->> 'requestedAt', payment ->> 'paymentId'
    ),
    '[]'::jsonb
  )
  into v_payments
  from jsonb_array_elements(coalesce(v_base -> 'payments', '[]'::jsonb)) as rows(payment)
  left join lateral (
    select payments.expected_amount
    from public.shipping_fee_payments as payments
    where payments.member_id = (payment ->> 'memberId')::uuid
      and payments.payment_context = 'auction_bundle'
      and payments.status = 'awaiting_transfer'
    limit 1
  ) as bundle on true;

  return jsonb_build_object(
    'payments', v_payments,
    'serverTime', v_base -> 'serverTime'
  );
end;
$$;

revoke all on function public.get_unified_manual_payment_queue(
  boolean,integer,integer
)
from public, anon, authenticated, service_role;
grant execute on function public.get_unified_manual_payment_queue(
  boolean,integer,integer
)
to authenticated;

create function public.confirm_prepaid_shipping_credit_payment(
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
  v_actor uuid := auth.uid();
  v_payment public.shipping_fee_payments%rowtype;
  v_received bigint;
  v_count integer;
  v_credit_count integer;
  v_fingerprint text;
  v_receipt public.inventory_command_receipts%rowtype;
  v_result jsonb;
begin
  if v_actor is null or not public.is_staff() then
    raise exception using errcode = '42501', message = '운영자 권한이 필요합니다.';
  end if;
  if p_payment_id is null
    or p_expected_version is null
    or p_expected_version < 0
    or p_observed_received_amount is null
    or p_observed_received_amount < 0
    or p_observed_ledger_entry_count is null
    or p_observed_ledger_entry_count < 0
    or p_idempotency_key is null
    or nullif(btrim(coalesce(p_depositor_name, '')), '') is null
    or char_length(btrim(p_depositor_name)) > 80
  then
    raise exception using errcode = '22023', message = '배송 크레딧 입금 확인 내용을 확인해 주세요.';
  end if;

  v_fingerprint := app_private.inventory_v2_fingerprint(
    jsonb_build_object(
      'kind', 'shipping_credit',
      'id', p_payment_id,
      'version', p_expected_version,
      'received', p_observed_received_amount,
      'count', p_observed_ledger_entry_count,
      'depositor', btrim(p_depositor_name)
    )
  );
  select receipts.*
  into v_receipt
  from public.inventory_command_receipts as receipts
  where receipts.actor_user_id = v_actor
    and receipts.idempotency_key = p_idempotency_key;
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
  where settings.singleton and settings.active_mode = 'manual_transfer'
  for update;
  if not found then
    raise exception using errcode = 'PT409', message = '수동 계좌이체 모드에서만 입금을 확인할 수 있습니다.';
  end if;

  select payments.*
  into v_payment
  from public.shipping_fee_payments as payments
  where payments.id = p_payment_id
    and payments.payment_context = 'shipping_credit'
    and payments.shipping_request_id is null
    and payments.inventory_shipment_id is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '배송 크레딧 결제 신청을 찾지 못했습니다.';
  end if;
  if v_payment.business_id is null
    or not app_private.can_confirm_shared_payment(v_payment.business_id)
  then
    raise exception using errcode = '42501', message = '배송 크레딧 입금을 확인할 권한이 없습니다.';
  end if;
  if v_payment.version is distinct from p_expected_version
    or v_payment.status not in ('awaiting_transfer', 'partially_paid')
  then
    raise exception using errcode = 'PT409', message = '배송 크레딧 결제 상태가 변경되었습니다.';
  end if;

  select
    coalesce(sum(case when ledger.entry_type = 'receipt' then ledger.amount else -ledger.amount end), 0)::bigint,
    count(ledger.id)::integer
  into v_received, v_count
  from public.manual_transfer_payment_ledger as ledger
  where ledger.shipping_fee_payment_id = p_payment_id;
  if v_received is distinct from p_observed_received_amount
    or v_count is distinct from p_observed_ledger_entry_count
  then
    raise exception using errcode = 'PT409', message = '입금 상태가 변경되었습니다. 새로고침 후 다시 확인해 주세요.';
  end if;
  if v_received < 0 or v_received >= v_payment.expected_amount then
    raise exception using errcode = '22023', message = '표시된 배송 크레딧 잔액 전체만 확인할 수 있습니다.';
  end if;

  insert into public.manual_transfer_payment_ledger (
    transfer_kind,
    shipping_fee_payment_id,
    entry_type,
    amount,
    depositor_name,
    memo,
    recorded_by,
    idempotency_key
  ) values (
    'shipping',
    p_payment_id,
    'receipt',
    v_payment.expected_amount - v_received,
    btrim(p_depositor_name),
    '배송 크레딧 결제',
    v_actor,
    p_idempotency_key::text
  );

  update public.member_accounts
  set shipping_credit_count =
    shipping_credit_count + v_payment.credit_quantity
  where member_id = v_payment.member_id
    and shipping_credit_count + v_payment.credit_quantity <= 10000
  returning shipping_credit_count into v_credit_count;
  if v_credit_count is null then
    raise exception using errcode = '22003', message = '배송 크레딧 한도에 도달했습니다.';
  end if;

  insert into public.shipping_credit_ledger (
    member_id,
    business_id,
    delta,
    reason,
    created_by
  ) values (
    v_payment.member_id,
    v_payment.business_id,
    v_payment.credit_quantity,
    'prepaid',
    v_actor
  );

  update public.shipping_fee_payments
  set
    status = 'confirmed',
    confirmed_at = clock_timestamp(),
    confirmed_by = v_actor
  where id = p_payment_id
    and status in ('awaiting_transfer', 'partially_paid');
  if not found then
    raise exception using errcode = 'PT409', message = '다른 운영자가 배송 크레딧 입금을 처리했습니다.';
  end if;

  select version into p_expected_version
  from public.shipping_fee_payments
  where id = p_payment_id;
  v_count := v_count + 1;
  v_result := jsonb_build_object(
    'payment_kind', 'shipping_fee',
    'payment_id', p_payment_id,
    'version', p_expected_version,
    'received_amount', v_payment.expected_amount,
    'remaining_amount', 0,
    'ledger_entry_count', v_count,
    'status', 'confirmed',
    'shipping_credit_quantity', v_payment.credit_quantity,
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
    p_payment_id,
    v_fingerprint,
    v_result,
    clock_timestamp()
  );
  return v_result;
end;
$$;

revoke all on function public.confirm_prepaid_shipping_credit_payment(
  uuid,bigint,text,bigint,integer,uuid
)
from public, anon, authenticated, service_role;
grant execute on function public.confirm_prepaid_shipping_credit_payment(
  uuid,bigint,text,bigint,integer,uuid
)
to authenticated;

alter function public.confirm_unified_manual_payment_v2(
  text,uuid,bigint,text,bigint,integer,uuid
)
rename to confirm_unified_manual_payment_v2_base;

revoke all on function public.confirm_unified_manual_payment_v2_base(
  text,uuid,bigint,text,bigint,integer,uuid
)
from public, anon, authenticated, service_role;

create function public.confirm_unified_manual_payment_v2(
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
begin
  if p_payment_kind = 'shipping_fee' and exists (
    select 1
    from public.shipping_fee_payments as payments
    where payments.id = p_payment_id
      and payments.payment_context = 'shipping_credit'
      and payments.shipping_request_id is null
      and payments.inventory_shipment_id is null
  ) then
    return public.confirm_prepaid_shipping_credit_payment(
      p_payment_id,
      p_expected_version,
      p_depositor_name,
      p_observed_received_amount,
      p_observed_ledger_entry_count,
      p_idempotency_key
    );
  end if;
  return public.confirm_unified_manual_payment_v2_base(
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

revoke all on function public.confirm_unified_manual_payment_v2(
  text,uuid,bigint,text,bigint,integer,uuid
)
from public, anon, authenticated, service_role;
grant execute on function public.confirm_unified_manual_payment_v2(
  text,uuid,bigint,text,bigint,integer,uuid
)
to authenticated;

create or replace function public.get_unified_manual_payment_queue(
  p_include_history boolean default false,
  p_limit integer default 200,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base jsonb;
  v_payments jsonb;
begin
  v_base := public.get_unified_manual_payment_queue_base(
    p_include_history,
    p_limit,
    p_offset
  );

  select coalesce(jsonb_agg(ordered.payment order by ordered.requested_at, ordered.payment_id), '[]'::jsonb)
  into v_payments
  from (
    select
      combined.payment,
      combined.payment ->> 'requestedAt' as requested_at,
      combined.payment ->> 'paymentId' as payment_id
    from (
      select case
        when payment ->> 'paymentKind' = 'auction'
          and payment ->> 'paymentId' = payment ->> 'memberId'
          and payment ->> 'status' = 'awaiting_manual_transfer'
        then payment || jsonb_build_object(
          'expectedAmount',
          (payment ->> 'expectedAmount')::bigint + coalesce(bundle.expected_amount, 0),
          'remainingAmount',
          (payment ->> 'remainingAmount')::bigint + coalesce(bundle.expected_amount, 0)
        )
        else payment
      end as payment
      from jsonb_array_elements(coalesce(v_base -> 'payments', '[]'::jsonb)) as rows(payment)
      left join lateral (
        select payments.expected_amount
        from public.shipping_fee_payments as payments
        where payments.member_id = (payment ->> 'memberId')::uuid
          and payments.payment_context = 'auction_bundle'
          and payments.status = 'awaiting_transfer'
        limit 1
      ) as bundle on true
    ) as combined

    union all

    select
      jsonb_build_object(
        'paymentKind', 'shipping_fee',
        'paymentId', payments.id,
        'businessId', payments.business_id,
        'memberId', payments.member_id,
        'reference', '배송 크레딧 ' || payments.credit_quantity::text || '개',
        'expectedAmount', payments.expected_amount,
        'receivedAmount', ledger.received,
        'remainingAmount', payments.expected_amount - ledger.received,
        'ledgerEntryCount', ledger.entries,
        'version', payments.version,
        'status', payments.status,
        'bankNameSnapshot', payments.bank_name_snapshot,
        'accountNumberSnapshot', payments.account_number_snapshot,
        'requestedAt', payments.requested_at,
        'confirmedAt', payments.confirmed_at,
        'confirmedBy', payments.confirmed_by,
        'lastDepositorName', ledger.last_depositor
      ),
      payments.requested_at::text,
      payments.id::text
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
    where payments.payment_context = 'shipping_credit'
      and payments.business_id is not null
      and (
        p_include_history
        or payments.status in ('awaiting_transfer', 'partially_paid')
      )
      and app_private.can_confirm_shared_payment(payments.business_id)
  ) as ordered;

  return jsonb_build_object(
    'payments', v_payments,
    'serverTime', v_base -> 'serverTime'
  );
end;
$$;

alter function public.record_shipping_fee_payment(
  uuid,bigint,text,bigint,integer,text,text
)
rename to record_single_shipping_credit_payment;

revoke all on function public.record_single_shipping_credit_payment(
  uuid,bigint,text,bigint,integer,text,text
)
from public, anon, authenticated, service_role;

create function public.record_shipping_fee_payment(
  p_payment_id uuid,
  p_amount bigint,
  p_depositor_name text,
  p_expected_received_amount bigint,
  p_expected_ledger_entry_count integer,
  p_idempotency_key text,
  p_memo text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.shipping_fee_payments%rowtype;
  v_was_confirmed boolean;
  v_result jsonb;
  v_credit_count integer;
begin
  select payments.*
  into v_payment
  from public.shipping_fee_payments as payments
  where payments.id = p_payment_id
  for update;
  v_was_confirmed := found and v_payment.status = 'confirmed';

  v_result := public.record_single_shipping_credit_payment(
    p_payment_id,
    p_amount,
    p_depositor_name,
    p_expected_received_amount,
    p_expected_ledger_entry_count,
    p_idempotency_key,
    p_memo
  );

  if v_payment.inventory_shipment_id is null
    and not v_was_confirmed
    and v_payment.credit_quantity > 1
    and v_result ->> 'status' = 'confirmed'
  then
    update public.member_accounts
    set shipping_credit_count =
      shipping_credit_count + v_payment.credit_quantity - 1
    where member_id = v_payment.member_id
      and shipping_credit_count + v_payment.credit_quantity - 1 <= 10000
    returning shipping_credit_count into v_credit_count;
    if v_credit_count is null then
      raise exception using errcode = '22003', message = '배송 크레딧 한도에 도달했습니다.';
    end if;
    insert into public.shipping_credit_ledger (
      member_id,
      delta,
      reason,
      created_by
    ) values (
      v_payment.member_id,
      v_payment.credit_quantity - 1,
      'prepaid',
      auth.uid()
    );
  end if;

  return v_result || jsonb_build_object(
    'shipping_credit_quantity', coalesce(v_payment.credit_quantity, 1)
  );
end;
$$;

revoke all on function public.record_shipping_fee_payment(
  uuid,bigint,text,bigint,integer,text,text
)
from public, anon, authenticated, service_role;
grant execute on function public.record_shipping_fee_payment(
  uuid,bigint,text,bigint,integer,text,text
)
to authenticated;

alter function public.reverse_shipping_fee_payment(
  text,uuid,uuid,bigint,integer,text,text
)
rename to reverse_single_shipping_credit_payment;

revoke all on function public.reverse_single_shipping_credit_payment(
  text,uuid,uuid,bigint,integer,text,text
)
from public, anon, authenticated, service_role;

create function public.reverse_shipping_fee_payment(
  p_expected_transfer_kind text,
  p_expected_transfer_id uuid,
  p_ledger_id uuid,
  p_expected_received_amount bigint,
  p_expected_ledger_entry_count integer,
  p_idempotency_key text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.shipping_fee_payments%rowtype;
  v_was_confirmed boolean;
  v_result jsonb;
  v_credit_count integer;
begin
  select payments.*
  into v_payment
  from public.shipping_fee_payments as payments
  where payments.id = p_expected_transfer_id
  for update;
  v_was_confirmed := found and v_payment.status = 'confirmed';

  v_result := public.reverse_single_shipping_credit_payment(
    p_expected_transfer_kind,
    p_expected_transfer_id,
    p_ledger_id,
    p_expected_received_amount,
    p_expected_ledger_entry_count,
    p_idempotency_key,
    p_reason
  );

  if v_payment.inventory_shipment_id is null
    and v_was_confirmed
    and v_payment.credit_quantity > 1
    and v_result ->> 'status' <> 'confirmed'
  then
    update public.member_accounts
    set shipping_credit_count =
      shipping_credit_count - (v_payment.credit_quantity - 1)
    where member_id = v_payment.member_id
      and shipping_credit_count >= v_payment.credit_quantity - 1
    returning shipping_credit_count into v_credit_count;
    if v_credit_count is null then
      raise exception using errcode = '55000', message = '사용된 배송 크레딧은 입금 취소할 수 없습니다.';
    end if;
    insert into public.shipping_credit_ledger (
      member_id,
      delta,
      reason,
      created_by
    ) values (
      v_payment.member_id,
      -(v_payment.credit_quantity - 1),
      'refund',
      auth.uid()
    );
  end if;

  return v_result || jsonb_build_object(
    'shipping_credit_quantity', coalesce(v_payment.credit_quantity, 1)
  );
end;
$$;

revoke all on function public.reverse_shipping_fee_payment(
  text,uuid,uuid,bigint,integer,text,text
)
from public, anon, authenticated, service_role;
grant execute on function public.reverse_shipping_fee_payment(
  text,uuid,uuid,bigint,integer,text,text
)
to authenticated;

commit;
