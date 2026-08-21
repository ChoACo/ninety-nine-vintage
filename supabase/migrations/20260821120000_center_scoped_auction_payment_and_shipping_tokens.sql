begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

-- ---------------------------------------------------------------------------
-- 1. Per-center fee breakdown on the auction bundle payment.
--    The bundle remembers which centers were actually charged so the operator
--    confirmation can grant one invisible per-center shipping token (waiver)
--    per charged center.
-- ---------------------------------------------------------------------------
alter table public.shipping_fee_payments
  add column if not exists fee_breakdown jsonb not null default '[]'::jsonb;

alter table public.shipping_fee_payments
  drop constraint if exists shipping_fee_payments_fee_breakdown_check;

alter table public.shipping_fee_payments
  add constraint shipping_fee_payments_fee_breakdown_check
  check (jsonb_typeof(fee_breakdown) = 'array');

comment on column public.shipping_fee_payments.fee_breakdown
  is 'Per-center shipping fee breakdown for auction bundles: [{"businessId": uuid, "amount": bigint}]. Zero-amount entries mark centers skipped because the buyer already stores items there.';

-- ---------------------------------------------------------------------------
-- 2. Auction bundles grant invisible per-center shipping tokens through the
--    existing waiver entitlement table instead of global credits.
-- ---------------------------------------------------------------------------
alter table public.shipping_fee_waiver_entitlements
  add column if not exists auction_bundle_payment_id uuid;

alter table public.shipping_fee_waiver_entitlements
  drop constraint shipping_fee_waiver_entitlements_source_check;

alter table public.shipping_fee_waiver_entitlements
  add constraint shipping_fee_waiver_entitlements_source_check
  check (
    num_nonnulls(exception_case_id, commerce_order_id, auction_bundle_payment_id) = 1
    and (
      (exception_case_id is not null and prepaid_amount is null)
      or (exception_case_id is null and prepaid_amount is not null)
    )
  );

create unique index if not exists shipping_fee_waiver_entitlements_bundle_business_idx
  on public.shipping_fee_waiver_entitlements (auction_bundle_payment_id, business_id)
  where auction_bundle_payment_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Quote RPC: payable auction wins grouped by fulfillment center with the
--    exact configured shipping fee and the stored-inventory rule. A center
--    that already stores any active item of the buyer is not charged: those
--    goods consolidate into a later shipment covered by an earlier token.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_auction_payment_quote()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_groups jsonb;
  v_item_total bigint;
  v_shipping_total bigint;
begin
  if v_actor is null or not public.is_member() then
    raise exception using errcode = '42501', message = '회원 로그인이 필요합니다.';
  end if;

  with payable_wins as (
    select
      wins.product_id,
      wins.title,
      wins.final_bid_amount,
      wins.payment_due_at
    from public.get_my_won_products() as wins
    where not wins.is_payment_settled
      and (
        wins.payment_due_at is null
        or wins.payment_due_at > clock_timestamp()
        or public.is_payment_deadline_exempt(v_actor)
      )
    ),
    win_centers as (
      select
        payable_wins.product_id,
        payable_wins.title,
        coalesce(orders.expected_amount, payable_wins.final_bid_amount) as amount,
        coalesce(
          orders.display_due_at,
          orders.due_at,
          payable_wins.payment_due_at
        ) as due_at,
        orders.requested_at,
        orders.id as order_id,
        stores.business_id,
        businesses.name as business_name,
        settings.shipping_fee_amount,
        (
          select count(*)::integer
          from public.customer_inventory_items as inventory
          join public.inventory_item_fulfillments as fulfillments
            on fulfillments.inventory_item_id = inventory.id
          where inventory.member_id = v_actor
            and inventory.business_id = stores.business_id
            and inventory.ownership_status = 'active'
            and not fulfillments.is_blocked
            and fulfillments.current_stage in (
              'entitled', 'preparing', 'in_transit_to_center',
              'center_received', 'center_stored'
            )
        ) > 0 as has_stored_items
      from payable_wins
      join public.products as products on products.id = payable_wins.product_id
      join public.stores as stores on stores.id = products.store_id
      join public.businesses as businesses on businesses.id = stores.business_id
      join public.inventory_fulfillment_rollout_settings as settings
        on settings.business_id = stores.business_id
      left join public.manual_transfer_orders as orders
        on orders.product_id = payable_wins.product_id
       and orders.buyer_id = v_actor
       and orders.status = 'awaiting_manual_transfer'
    ),
    center_rows as (
      select
        win_centers.business_id,
        win_centers.business_name,
        win_centers.shipping_fee_amount,
        count(*)::integer as item_count,
        sum(win_centers.amount)::bigint as item_subtotal,
        min(win_centers.due_at) as earliest_due_at,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'productId', win_centers.product_id,
              'title', win_centers.title,
              'amount', win_centers.amount,
              'dueAt', win_centers.due_at
            )
            order by win_centers.requested_at nulls last, win_centers.order_id nulls last, win_centers.product_id
          ),
          '[]'::jsonb
        ) as items,
        bool_or(win_centers.has_stored_items) as has_stored_items
      from win_centers
      group by win_centers.business_id, win_centers.business_name, win_centers.shipping_fee_amount
    )
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'businessId', business_id,
            'businessName', business_name,
            'itemCount', item_count,
            'itemSubtotal', item_subtotal,
            'earliestDueAt', earliest_due_at,
            'items', items,
            'hasStoredItems', has_stored_items,
            'shippingFeeAmount', shipping_fee_amount,
            'shippingFeeCharged', case when has_stored_items then 0 else shipping_fee_amount end
          )
          order by business_name, business_id
        ),
        '[]'::jsonb
      ),
      coalesce(sum(item_subtotal), 0)::bigint,
      coalesce(sum(
        case when has_stored_items then 0 else shipping_fee_amount end
      ), 0)::bigint
    into v_groups, v_item_total, v_shipping_total
    from center_rows;

  return jsonb_build_object(
    'groups', v_groups,
    'itemSubtotal', v_item_total,
    'shippingFeeTotal', v_shipping_total,
    'expectedTotal', v_item_total + v_shipping_total,
    'serverTime', clock_timestamp()
  );
end;
$$;

revoke all on function public.get_my_auction_payment_quote()
from public, anon, authenticated, service_role;
grant execute on function public.get_my_auction_payment_quote()
to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Base items builder: begins order ledgers for the selected wins only.
--    Aggregates always span the member's whole pending pool because every
--    awaiting order settles together in one deposit.
-- ---------------------------------------------------------------------------
create or replace function public.begin_my_combined_auction_items(
  p_depositor_name text,
  p_product_ids uuid[] default null
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

  for v_win in
    select wins.product_id
    from public.get_my_won_products() as wins
    where not wins.is_payment_settled
      and (
        wins.payment_due_at is null
        or wins.payment_due_at > clock_timestamp()
        or public.is_payment_deadline_exempt(v_actor)
      )
      and (p_product_ids is null or wins.product_id = any(p_product_ids))
    order by wins.product_id
  loop
    perform public.begin_manual_transfer(v_win.product_id);
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

revoke all on function public.begin_my_combined_auction_items(text, uuid[])
from public, anon, authenticated, service_role;
grant execute on function public.begin_my_combined_auction_items(text, uuid[])
to authenticated;

drop function if exists public.begin_my_combined_auction_items(text);

-- ---------------------------------------------------------------------------
-- 5. Selective begin: only chosen wins enter the pending pool, but the fee
--    and totals cover the whole pool so the deposit stays reconcilable.
-- ---------------------------------------------------------------------------
create or replace function public.begin_my_combined_auction_payment(
  p_depositor_name text,
  p_include_shipping_fee boolean default true,
  p_product_ids uuid[] default null
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
  v_breakdown jsonb := '[]'::jsonb;
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

  if p_product_ids is not null then
    if cardinality(p_product_ids) < 1
      or cardinality(p_product_ids) <> cardinality(
        array(select distinct x from unnest(p_product_ids) x)
      )
    then
      raise exception using errcode = '22023', message = '결제할 상품을 중복 없이 선택해 주세요.';
    end if;
    if (
      select count(*)
      from public.get_my_won_products() as wins
      where wins.product_id = any(p_product_ids)
        and not wins.is_payment_settled
        and (
          wins.payment_due_at is null
          or wins.payment_due_at > clock_timestamp()
          or public.is_payment_deadline_exempt(v_actor)
        )
    ) <> cardinality(p_product_ids)
    then
      raise exception using errcode = '22000', message = '선택한 낙찰품 중 결제할 수 없는 상품이 있습니다. 새로고침 후 다시 선택해 주세요.';
    end if;
  end if;

  v_items := public.begin_my_combined_auction_items(p_depositor_name, p_product_ids);

  -- Per-center fee across the whole pending pool: a center storing any of
  -- the buyer's active items is skipped (later consolidated shipment), every
  -- other center contributes its configured fee exactly once.
  with pool_centers as (
    select
      stores.business_id,
      settings.shipping_fee_amount,
      bool_or((
        select count(*)::integer
        from public.customer_inventory_items as inventory
        join public.inventory_item_fulfillments as fulfillments
          on fulfillments.inventory_item_id = inventory.id
        where inventory.member_id = v_actor
          and inventory.business_id = stores.business_id
          and inventory.ownership_status = 'active'
          and not fulfillments.is_blocked
          and fulfillments.current_stage in (
            'entitled', 'preparing', 'in_transit_to_center',
            'center_received', 'center_stored'
          )
      ) > 0) as has_stored_items
    from public.manual_transfer_orders as orders
    join public.products as products on products.id = orders.product_id
    join public.stores as stores on stores.id = products.store_id
    join public.inventory_fulfillment_rollout_settings as settings
      on settings.business_id = stores.business_id
    where orders.buyer_id = v_actor
      and orders.status = 'awaiting_manual_transfer'
    group by stores.business_id, settings.shipping_fee_amount
  )
  select
    coalesce(sum(case when has_stored_items then 0 else shipping_fee_amount end), 0)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'businessId', business_id,
          'amount', case when has_stored_items then 0 else shipping_fee_amount end
        )
        order by business_id
      ),
      '[]'::jsonb
    )
  into v_shipping_fee, v_breakdown
  from pool_centers;

  if exists (
    select 1
    from public.manual_transfer_orders as orders
    join public.products as products on products.id = orders.product_id
    join public.stores as stores on stores.id = products.store_id
    left join public.inventory_fulfillment_rollout_settings as settings
      on settings.business_id = stores.business_id
    where orders.buyer_id = v_actor
      and orders.status = 'awaiting_manual_transfer'
      and settings.shipping_fee_amount is null
  ) and p_include_shipping_fee then
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

  if not p_include_shipping_fee then
    if v_bundle.id is not null then
      if v_bundle.status = 'partially_paid' then
        raise exception using
          errcode = 'PT409',
          message = '일부 입금된 택배비는 결제에서 제외할 수 없습니다.';
      end if;
      update public.shipping_fee_payments
      set status = 'cancelled'
      where id = v_bundle.id and status = 'awaiting_transfer';
    end if;
    v_shipping_fee := 0;
    v_bundle := null;
  elsif v_shipping_fee > 0 then
    if v_bundle.id is not null
      and v_bundle.status = 'partially_paid'
      and v_bundle.expected_amount <> v_shipping_fee
    then
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
        payment_context,
        fee_breakdown
      ) values (
        v_actor,
        v_shipping_fee,
        v_bank_name,
        v_account_number,
        v_bundle_key,
        1,
        'auction_bundle',
        v_breakdown
      )
      returning * into v_bundle;
    elsif v_bundle.status = 'awaiting_transfer' then
      update public.shipping_fee_payments
      set
        expected_amount = v_shipping_fee,
        bank_name_snapshot = v_bank_name,
        account_number_snapshot = v_account_number,
        idempotency_key = v_bundle_key,
        fee_breakdown = v_breakdown
      where id = v_bundle.id
      returning * into v_bundle;
    end if;
  else
    -- Fee included but every center was waived by stored inventory: there is
    -- nothing to collect, so no bundle row must exist.
    if v_bundle.id is not null then
      if v_bundle.status = 'partially_paid' then
        raise exception using
          errcode = 'PT409',
          message = '일부 입금된 택배비가 있어 결제 구성을 변경할 수 없습니다.';
      end if;
      update public.shipping_fee_payments
      set status = 'cancelled'
      where id = v_bundle.id and status = 'awaiting_transfer';
    end if;
    v_bundle := null;
  end if;

  return v_items || jsonb_build_object(
    'itemSubtotal', (v_items ->> 'expectedAmount')::bigint,
    'shippingFee', v_shipping_fee,
    'shippingFeeBreakdown', v_breakdown,
    'includeShippingFee', p_include_shipping_fee,
    'expectedAmount', (v_items ->> 'expectedAmount')::bigint + v_shipping_fee
  );
end;
$$;

revoke all on function public.begin_my_combined_auction_payment(text, boolean, uuid[])
from public, anon, authenticated, service_role;
grant execute on function public.begin_my_combined_auction_payment(text, boolean, uuid[])
to authenticated;

drop function if exists public.begin_my_combined_auction_payment(text, boolean);

create or replace function public.begin_my_combined_auction_payment(
  p_depositor_name text,
  p_include_shipping_fee boolean
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.begin_my_combined_auction_payment(
    p_depositor_name, p_include_shipping_fee, null::uuid[]
  );
$$;

revoke all on function public.begin_my_combined_auction_payment(text, boolean)
from public, anon, authenticated, service_role;
grant execute on function public.begin_my_combined_auction_payment(text, boolean)
to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Operator confirmation grants one invisible per-center shipping token
--    per charged center instead of global credits.
-- ---------------------------------------------------------------------------
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
  v_bundle public.shipping_fee_payments%rowtype;
  v_result jsonb;
  v_child_hash text;
  v_child_key text;
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

    -- One invisible shipping token per charged center. Centers skipped
    -- because of stored inventory receive none and stay free to ship.
    insert into public.shipping_fee_waiver_entitlements (
      member_id,
      business_id,
      exception_case_id,
      commerce_order_id,
      auction_bundle_payment_id,
      prepaid_amount
    )
    select
      v_bundle.member_id,
      (entry.value ->> 'businessId')::uuid,
      null,
      null,
      v_bundle.id,
      (entry.value ->> 'amount')::bigint
    from jsonb_array_elements(v_bundle.fee_breakdown) as entry
    where (entry.value ->> 'amount')::bigint > 0
    on conflict (auction_bundle_payment_id, business_id)
      where auction_bundle_payment_id is not null
    do nothing;

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
      'shipping_token_centers', (
        select count(*)::integer
        from jsonb_array_elements(v_bundle.fee_breakdown) as entry
        where (entry.value ->> 'amount')::bigint > 0
      ),
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

commit;
