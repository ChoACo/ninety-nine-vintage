-- Make second-chance offers an explicit owner/operator action and provide an
-- Owner-only, audited recovery path for bank transfers that were received but
-- expired before the owner confirmation ledger could be processed.
begin;

-- ---------------------------------------------------------------------------
-- 1. A second-chance row may only be inserted by the explicit staff RPC.
--    The scheduled expiry processor still cancels the unpaid winner and applies
--    policy warnings, but this BEFORE trigger silently skips its successor insert.
-- ---------------------------------------------------------------------------
create or replace function app_private.guard_manual_second_chance_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_role text;
begin
  if new.offer_kind <> 'second_chance' then
    return new;
  end if;

  v_role := public.access_role_for_user(auth.uid());
  select products.store_id into v_store_id
  from public.products as products
  where products.id = new.product_id;

  if coalesce(current_setting('app.manual_second_chance', true), '') = 'on'
    and auth.uid() is not null
    and v_role in ('owner', 'operator')
    and public.can_manage_product_store(v_store_id)
  then
    return new;
  end if;

  return null;
end;
$$;

revoke all on function app_private.guard_manual_second_chance_insert()
from public, anon, authenticated, service_role;

drop trigger if exists auction_purchase_offers_require_manual_second_chance
on public.auction_purchase_offers;
create trigger auction_purchase_offers_require_manual_second_chance
before insert on public.auction_purchase_offers
for each row execute function app_private.guard_manual_second_chance_insert();

create or replace function public.operator_process_second_chance_manual(
  p_product_id uuid
)
returns table (
  product_id uuid,
  processed_count integer,
  offer_id uuid,
  offer_status text,
  bidder_display_name text,
  offered_amount bigint,
  response_due_at timestamptz,
  server_time timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_now timestamptz := clock_timestamp();
  v_product public.products%rowtype;
  v_original public.auction_purchase_offers%rowtype;
  v_second public.auction_purchase_offers%rowtype;
  v_next_bid public.auction_bids%rowtype;
  v_processed integer := 0;
  v_second_chance_hours integer;
begin
  if p_product_id is null then
    raise exception using errcode = '22023', message = '차순위 처리할 경매를 선택해 주세요.';
  end if;
  v_role := public.access_role_for_user(v_actor);
  if v_actor is null or v_role not in ('owner', 'operator') then
    raise exception using errcode = '42501', message = '소유자 또는 운영자 권한이 필요합니다.';
  end if;

  select products.* into v_product
  from public.products as products
  where products.id = p_product_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '경매 상품을 찾을 수 없습니다.';
  end if;
  if not public.can_manage_product_store(v_product.store_id) then
    raise exception using errcode = '42501', message = '담당 숍의 경매만 처리할 수 있습니다.';
  end if;
  if v_product.sale_type <> 'auction' or v_product.status <> 'closed' then
    raise exception using errcode = 'P0001', message = '마감된 경매만 차순위 처리할 수 있습니다.';
  end if;

  select offers.* into v_second
  from public.auction_purchase_offers as offers
  where offers.product_id = p_product_id
    and offers.offer_kind = 'second_chance'
  order by offers.offer_round desc
  limit 1;
  if found then
    return query select p_product_id, 0, v_second.id, v_second.status,
      v_second.bidder_display_name_snapshot, v_second.offered_amount,
      v_second.response_due_at, v_now;
    return;
  end if;

  select offers.* into v_original
  from public.auction_purchase_offers as offers
  where offers.product_id = p_product_id
    and offers.offer_kind = 'original'
  order by offers.offer_round
  limit 1;
  if not found then
    raise exception using errcode = 'P0001', message = '차순위 처리할 낙찰 원장이 없습니다.';
  end if;
  if v_original.status = 'settled' then
    raise exception using errcode = 'P0001', message = '이미 결제가 완료된 낙찰입니다.';
  end if;
  if v_original.status in ('payment_due', 'accepted')
    and (v_original.payment_due_at is null or v_original.payment_due_at > v_now)
  then
    raise exception using errcode = 'P0001', message = '원 낙찰자의 결제 기한이 아직 지나지 않았습니다.';
  end if;
  if v_original.status not in ('payment_due', 'accepted', 'expired_unpaid') then
    raise exception using errcode = 'P0001', message = '현재 차순위를 생성할 수 없는 낙찰 상태입니다.';
  end if;

  -- Expire and reconcile the original winner first. The insertion guard above
  -- prevents this processor call from creating a successor on its own.
  v_processed := app_private.process_auction_purchase_offer_for_product(
    p_product_id,
    v_now
  );

  select offers.* into v_original
  from public.auction_purchase_offers as offers
  where offers.product_id = p_product_id
    and offers.offer_kind = 'original'
  order by offers.offer_round
  limit 1;
  if v_original.status <> 'expired_unpaid' then
    raise exception using errcode = 'P0001', message = '미결제 만료된 원 낙찰을 확인할 수 없습니다.';
  end if;

  select settings.second_chance_hours into v_second_chance_hours
  from public.auction_revenue_defense_settings as settings
  where settings.singleton;

  select bids.* into v_next_bid
  from public.auction_bids as bids
  where bids.product_id = p_product_id
    and bids.bidder_id is not null
    and coalesce(public.access_role_for_user(bids.bidder_id), '') in ('member', 'band_member')
    and not public.is_owner_hidden_test_member(bids.bidder_id)
    and exists (
      select 1 from public.member_accounts as accounts
      where accounts.member_id = bids.bidder_id
        and accounts.account_status = 'active'
    )
    and not exists (
      select 1 from public.member_bid_sanctions as sanctions
      where sanctions.member_id = bids.bidder_id
        and sanctions.status = 'active'
        and sanctions.starts_at <= v_now
        and sanctions.ends_at > v_now
    )
  order by bids.amount desc, bids.created_at, bids.id
  limit 1;

  if v_next_bid.id is not null then
    perform set_config('app.manual_second_chance', 'on', true);
    insert into public.auction_purchase_offers (
      product_id, offer_round, offer_kind, bid_id, bidder_id,
      bidder_display_name_snapshot, offered_amount, status, offered_at,
      response_due_at, payment_due_at, previous_offer_id
    ) values (
      p_product_id, 2, 'second_chance', v_next_bid.id, v_next_bid.bidder_id,
      v_next_bid.bidder_display_name, v_next_bid.amount, 'offered', v_now,
      v_now + make_interval(hours => v_second_chance_hours),
      case when public.is_payment_deadline_exempt(v_next_bid.bidder_id) then null
        else v_now + make_interval(hours => v_second_chance_hours) end,
      v_original.id
    )
    returning * into v_second;
  end if;

  perform app_private.write_security_activity(
    v_actor, v_second.bidder_id, 'auction', 'auction.second_chance.processed',
    'process', 'operator_process_second_chance_manual', 'product',
    p_product_id::text, 'notice', null, null,
    jsonb_build_object(
      'product_id', p_product_id,
      'processor_count', v_processed,
      'second_chance_offer_id', v_second.id,
      'result', case when v_second.id is null then 'no_successor' else v_second.status end,
      'manual', true
    ),
    v_now
  );

  return query select p_product_id, v_processed, v_second.id,
    case when v_second.id is null then 'no_successor' else v_second.status end,
    v_second.bidder_display_name_snapshot, v_second.offered_amount,
    v_second.response_due_at, v_now;
end;
$$;

revoke all on function public.operator_process_second_chance(uuid)
from authenticated;
revoke all on function public.operator_process_second_chance_manual(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.operator_process_second_chance_manual(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Register the Owner ledger in the same transaction that creates the bank
--    transfer orders. The later "I paid" action promotes this row and extends
--    the review deadline; creating the payment instructions alone never marks
--    money as received.
-- ---------------------------------------------------------------------------
alter table public.auction_payment_confirmation_requests
  drop constraint if exists auction_payment_confirmation_requests_request_kind_check;
alter table public.auction_payment_confirmation_requests
  add constraint auction_payment_confirmation_requests_request_kind_check
  check (request_kind in ('payment_started', 'buyer', 'system_reconciliation'));

alter table public.auction_payment_confirmation_request_events
  drop constraint if exists auction_payment_confirmation_request_events_event_kind_check;
alter table public.auction_payment_confirmation_request_events
  add constraint auction_payment_confirmation_request_events_event_kind_check
  check (event_kind in ('started', 'requested', 'reminded', 'detected', 'resolved'));

create or replace function public.begin_my_combined_auction_payment_registered(
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
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
  v_order_ids uuid[];
  v_expected bigint;
  v_original_due_at timestamptz;
  v_shipping public.shipping_fee_payments%rowtype;
  v_request public.auction_payment_confirmation_requests%rowtype;
  v_batch_key text;
  v_depositor_name text;
  v_owner_id uuid;
  v_created boolean := false;
begin
  v_result := public.begin_my_combined_auction_payment(
    p_depositor_name,
    p_include_shipping_fee,
    p_product_ids
  );

  select array_agg((entry.value ->> 'orderId')::uuid order by (entry.value ->> 'orderId')::uuid)
  into v_order_ids
  from jsonb_array_elements(coalesce(v_result -> 'items', '[]'::jsonb)) as entry;
  if coalesce(cardinality(v_order_ids), 0) not between 1 and 100 then
    raise exception using errcode = '55000', message = '소유자 입금 원장에 연결할 주문을 확인하지 못했습니다.';
  end if;

  select sum(orders.expected_amount)::bigint,
         min(coalesce(orders.display_due_at, orders.due_at))
  into v_expected, v_original_due_at
  from public.manual_transfer_orders as orders
  where orders.id = any(v_order_ids)
    and orders.buyer_id = v_actor
    and orders.status = 'awaiting_manual_transfer';
  if v_expected is null then
    raise exception using errcode = '55000', message = '소유자 입금 원장에 연결할 결제 대상을 찾지 못했습니다.';
  end if;

  select payments.* into v_shipping
  from public.shipping_fee_payments as payments
  where payments.member_id = v_actor
    and payments.payment_context = 'auction_bundle'
    and payments.status in ('awaiting_transfer', 'partially_paid')
  for update;
  v_expected := v_expected + coalesce(v_shipping.expected_amount, 0);
  select nullif(btrim(accounts.last_depositor_name), '') into v_depositor_name
  from public.member_accounts as accounts
  where accounts.member_id = v_actor;
  if v_depositor_name is null then
    raise exception using errcode = '55000', message = '입금자명을 확인하지 못했습니다.';
  end if;

  v_batch_key := md5(v_actor::text || ':' || array_to_string(v_order_ids, ','));
  insert into public.auction_payment_confirmation_requests (
    member_id, batch_key, request_kind, order_ids,
    shipping_fee_payment_id, expected_amount, depositor_name,
    first_requested_at, last_requested_at, original_due_at, review_due_at
  ) values (
    v_actor, v_batch_key, 'payment_started', v_order_ids,
    v_shipping.id, v_expected, v_depositor_name,
    v_now, v_now, v_original_due_at, null
  )
  on conflict (batch_key) do nothing
  returning * into v_request;
  v_created := found;

  if not v_created then
    select requests.* into v_request
    from public.auction_payment_confirmation_requests as requests
    where requests.batch_key = v_batch_key
    for update;
    if v_request.status <> 'open' then
      raise exception using errcode = '55000', message = '이미 처리된 입금 원장입니다.';
    end if;
    update public.auction_payment_confirmation_requests
    set order_ids = v_order_ids,
        shipping_fee_payment_id = v_shipping.id,
        expected_amount = v_expected,
        depositor_name = v_depositor_name,
        original_due_at = v_original_due_at,
        version = version + 1
    where id = v_request.id
    returning * into v_request;
  else
    insert into public.auction_payment_confirmation_request_events (
      request_id, event_kind, actor_user_id, metadata
    ) values (
      v_request.id, 'started', v_actor,
      jsonb_build_object('expectedAmount', v_expected, 'orderCount', cardinality(v_order_ids))
    );

    for v_owner_id in
      select roles.user_id from public.account_access_roles as roles
      where roles.role_code = 'owner'
    loop
      perform app_private.insert_targeted_notification(
        v_owner_id, 'owner', 'payment_verification_requested',
        '낙찰품 계좌이체 절차가 시작되었습니다',
        v_depositor_name || ' 명의의 ' || v_expected::text || '원 결제 원장을 확인해 주세요.',
        '/admin/owner/payments?queue=auction-confirmation-requests'
      );
    end loop;
  end if;

  return v_result || jsonb_build_object(
    'ownerRequestId', v_request.id,
    'ownerLedgerRegisteredAt', v_request.first_requested_at
  );
end;
$$;

revoke all on function public.begin_my_combined_auction_payment_registered(text,boolean,uuid[])
from public, anon, authenticated, service_role;
grant execute on function public.begin_my_combined_auction_payment_registered(text,boolean,uuid[])
to authenticated;

create or replace function public.request_my_combined_auction_payment_confirmation_v2(
  p_order_ids uuid[],
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
  v_review_due_at timestamptz := v_now + interval '24 hours';
  v_order_ids uuid[];
  v_offer_ids uuid[];
  v_request public.auction_payment_confirmation_requests%rowtype;
  v_batch_key text;
  v_owner_id uuid;
begin
  if v_actor is null or not public.is_member() then
    raise exception using errcode = '42501', message = '회원 로그인이 필요합니다.';
  end if;
  if p_idempotency_key is null
    or coalesce(cardinality(p_order_ids), 0) not between 1 and 100
    or cardinality(p_order_ids) <> cardinality(array(select distinct x from unnest(p_order_ids) x))
  then
    raise exception using errcode = '22023', message = '입금 확인 요청 대상을 확인해 주세요.';
  end if;

  select array_agg(orders.id order by orders.id),
         array_agg(orders.purchase_offer_id order by orders.id)
           filter (where orders.purchase_offer_id is not null)
  into v_order_ids, v_offer_ids
  from public.manual_transfer_orders as orders
  where orders.id = any(p_order_ids)
    and orders.buyer_id = v_actor
    and orders.status = 'awaiting_manual_transfer';
  if coalesce(cardinality(v_order_ids), 0) <> cardinality(p_order_ids) then
    raise exception using errcode = 'P0002', message = '입금 대기 중인 낙찰 결제 묶음을 찾지 못했습니다.';
  end if;

  v_batch_key := md5(v_actor::text || ':' || array_to_string(v_order_ids, ','));
  select requests.* into v_request
  from public.auction_payment_confirmation_requests as requests
  where requests.batch_key = v_batch_key
  for update;

  if found and v_request.status = 'open' and v_request.request_kind = 'payment_started' then
    if exists (
      select 1 from public.auction_payment_confirmation_request_events as events
      where events.request_id = v_request.id
        and events.idempotency_key = p_idempotency_key
    ) then
      return jsonb_build_object(
        'id', v_request.id, 'status', v_request.status,
        'firstRequestedAt', v_request.first_requested_at,
        'lastRequestedAt', v_request.last_requested_at,
        'reminderCount', v_request.reminder_count,
        'reviewDueAt', v_request.review_due_at, 'replayed', true
      );
    end if;

    update public.auction_payment_confirmation_requests
    set request_kind = 'buyer',
        last_requested_at = v_now,
        review_due_at = v_review_due_at,
        version = version + 1
    where id = v_request.id
    returning * into v_request;

    update public.manual_transfer_orders
    set due_at = greatest(coalesce(due_at, v_review_due_at), v_review_due_at),
        display_due_at = greatest(coalesce(display_due_at, v_review_due_at), v_review_due_at)
    where id = any(v_order_ids)
      and status = 'awaiting_manual_transfer'
      and payment_deadline_held_at is null;
    if coalesce(cardinality(v_offer_ids), 0) > 0 then
      update public.auction_purchase_offers
      set payment_due_at = greatest(coalesce(payment_due_at, v_review_due_at), v_review_due_at)
      where id = any(v_offer_ids)
        and status in ('payment_due', 'accepted');
    end if;

    insert into public.auction_payment_confirmation_request_events (
      request_id, event_kind, actor_user_id, idempotency_key, metadata
    ) values (
      v_request.id, 'requested', v_actor, p_idempotency_key,
      jsonb_build_object('promotedFrom', 'payment_started', 'reviewDueAt', v_review_due_at)
    );
    for v_owner_id in
      select roles.user_id from public.account_access_roles as roles
      where roles.role_code = 'owner'
    loop
      perform app_private.insert_targeted_notification(
        v_owner_id, 'owner', 'payment_verification_requested',
        '낙찰품 입금 확인 요청이 있습니다',
        v_request.depositor_name || ' 명의의 ' || v_request.expected_amount::text || '원 입금 여부를 확인해 주세요.',
        '/admin/owner/payments?queue=auction-confirmation-requests'
      );
    end loop;

    return jsonb_build_object(
      'id', v_request.id, 'status', v_request.status,
      'firstRequestedAt', v_request.first_requested_at,
      'lastRequestedAt', v_request.last_requested_at,
      'reminderCount', v_request.reminder_count,
      'reviewDueAt', v_request.review_due_at, 'replayed', false
    );
  end if;

  return public.request_my_combined_auction_payment_confirmation(
    p_order_ids,
    p_idempotency_key
  );
end;
$$;

revoke all on function public.request_my_combined_auction_payment_confirmation_v2(uuid[],uuid)
from public, anon, authenticated, service_role;
grant execute on function public.request_my_combined_auction_payment_confirmation_v2(uuid[],uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Owner-only forced confirmation with an explicit settlement disposition.
-- ---------------------------------------------------------------------------
alter table public.manual_transfer_orders
  add column if not exists settlement_disposition text not null default 'included',
  add column if not exists owner_forced_confirmed_at timestamptz,
  add column if not exists owner_forced_confirmed_by uuid references public.profiles(id) on delete restrict,
  add column if not exists owner_forced_confirmation_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'manual_transfer_orders_settlement_disposition_check'
      and conrelid = 'public.manual_transfer_orders'::regclass
  ) then
    alter table public.manual_transfer_orders
      add constraint manual_transfer_orders_settlement_disposition_check
      check (settlement_disposition in ('included', 'excluded'));
  end if;
end $$;

alter table public.customer_inventory_items
  add column if not exists settlement_disposition text not null default 'included',
  add column if not exists settlement_disposition_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'customer_inventory_items_settlement_disposition_check'
      and conrelid = 'public.customer_inventory_items'::regclass
  ) then
    alter table public.customer_inventory_items
      add constraint customer_inventory_items_settlement_disposition_check
      check (settlement_disposition in ('included', 'excluded'));
  end if;
end $$;

alter table public.member_warnings
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles(id) on delete restrict,
  add column if not exists void_reason text;

create table if not exists public.owner_forced_payment_confirmations (
  id uuid primary key default gen_random_uuid(),
  actor_owner_id uuid not null references public.profiles(id) on delete restrict,
  request_id uuid not null references public.auction_payment_confirmation_requests(id) on delete restrict,
  member_id uuid not null references public.profiles(id) on delete restrict,
  order_ids uuid[] not null check (cardinality(order_ids) between 1 and 100),
  settlement_disposition text not null check (settlement_disposition in ('included', 'excluded')),
  depositor_name text not null check (char_length(btrim(depositor_name)) between 1 and 80),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  idempotency_key uuid not null,
  request_fingerprint text not null,
  before_state jsonb not null check (jsonb_typeof(before_state) = 'object'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  unique (actor_owner_id, idempotency_key)
);

create index if not exists owner_forced_payment_confirmations_request_idx
on public.owner_forced_payment_confirmations(request_id, created_at desc);

alter table public.owner_forced_payment_confirmations enable row level security;
alter table public.owner_forced_payment_confirmations force row level security;
revoke all on table public.owner_forced_payment_confirmations
from public, anon, authenticated, service_role;

create or replace function app_private.guard_manual_transfer_deadline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.auction_purchase_offers%rowtype;
begin
  if app_private.owner_force_ledger_enabled() then
    return new;
  end if;
  if new.status = 'confirmed' and old.status = 'awaiting_manual_transfer' then
    if old.due_at is not null and clock_timestamp() >= old.due_at then
      raise exception using errcode = '55000', message = '입금 확인 기한이 지나 차순위 승계 처리 대상입니다.';
    end if;
    if old.purchase_offer_id is not null then
      select offers.* into v_offer
      from public.auction_purchase_offers as offers
      where offers.id = old.purchase_offer_id
      for update;
      if v_offer.id is null
        or v_offer.product_id <> old.product_id
        or v_offer.bidder_id is distinct from old.buyer_id
        or v_offer.status not in ('payment_due', 'accepted')
        or (v_offer.payment_due_at is not null and clock_timestamp() >= v_offer.payment_due_at)
      then
        raise exception using errcode = '55000', message = '현재 유효한 낙찰 결제 권한이 아닙니다.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_manual_transfer_deadline()
from public, anon, authenticated, service_role;

create or replace function public.owner_force_confirm_auction_payment_request(
  p_request_id uuid,
  p_expected_version bigint,
  p_depositor_name text,
  p_include_in_settlement boolean,
  p_reason text,
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
  v_reason text := btrim(coalesce(p_reason, ''));
  v_disposition text := case when p_include_in_settlement then 'included' else 'excluded' end;
  v_fingerprint text;
  v_request public.auction_payment_confirmation_requests%rowtype;
  v_existing public.owner_forced_payment_confirmations%rowtype;
  v_order public.manual_transfer_orders%rowtype;
  v_shipping public.shipping_fee_payments%rowtype;
  v_product_ids uuid[];
  v_offer_ids uuid[];
  v_received bigint;
  v_remaining bigint;
  v_child_hash text;
  v_child_key text;
  v_before jsonb;
  v_result jsonb;
  v_warning_count integer := 0;
begin
  if v_actor is null or not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if p_request_id is null or p_expected_version is null or p_expected_version < 0
    or p_idempotency_key is null or p_include_in_settlement is null
    or char_length(v_name) not between 1 and 80
    or char_length(v_reason) not between 3 and 500
  then
    raise exception using errcode = '22023', message = '강제 결제완료 처리값을 확인해 주세요.';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'requestId', p_request_id,
    'expectedVersion', p_expected_version,
    'depositorName', v_name,
    'settlementDisposition', v_disposition,
    'reason', v_reason
  )::text);

  select confirmations.* into v_existing
  from public.owner_forced_payment_confirmations as confirmations
  where confirmations.actor_owner_id = v_actor
    and confirmations.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = '같은 요청 키를 다른 강제 결제완료에 재사용할 수 없습니다.';
    end if;
    return v_existing.result || jsonb_build_object('idempotentReplay', true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('owner-force-payment:' || p_request_id::text, 0));
  select requests.* into v_request
  from public.auction_payment_confirmation_requests as requests
  where requests.id = p_request_id;
  if not found then
    raise exception using errcode = 'P0002', message = '입금 확인 요청을 찾을 수 없습니다.';
  end if;
  if v_request.status <> 'open' or v_request.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = '입금 확인 요청 상태가 변경되었습니다.';
  end if;

  select array_agg(distinct orders.product_id order by orders.product_id),
         array_agg(orders.purchase_offer_id order by orders.id)
           filter (where orders.purchase_offer_id is not null)
  into v_product_ids, v_offer_ids
  from public.manual_transfer_orders as orders
  where orders.id = any(v_request.order_ids)
    and orders.buyer_id = v_request.member_id;
  if coalesce(cardinality(v_product_ids), 0) = 0 then
    raise exception using errcode = 'P0002', message = '강제 완료할 낙찰 주문을 찾을 수 없습니다.';
  end if;

  perform products.id from public.products as products
  where products.id = any(v_product_ids)
  order by products.id for update;
  perform offers.id from public.auction_purchase_offers as offers
  where offers.product_id = any(v_product_ids)
  order by offers.id for update;
  perform orders.id from public.manual_transfer_orders as orders
  where orders.product_id = any(v_product_ids)
  order by orders.id for update;
  if v_request.shipping_fee_payment_id is not null then
    perform payments.id from public.shipping_fee_payments as payments
    where payments.id = v_request.shipping_fee_payment_id
    for update;
  end if;
  select requests.* into v_request
  from public.auction_payment_confirmation_requests as requests
  where requests.id = p_request_id
  for update;
  if v_request.status <> 'open' or v_request.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = '입금 확인 요청 상태가 변경되었습니다.';
  end if;

  if (
    select count(*) from public.manual_transfer_orders as orders
    where orders.id = any(v_request.order_ids)
      and orders.buyer_id = v_request.member_id
      and orders.status in ('awaiting_manual_transfer', 'cancelled_unpaid')
  ) <> cardinality(v_request.order_ids) then
    raise exception using errcode = '55000', message = '대상 주문 중 이미 완료·철회되었거나 다른 상태인 원장이 있습니다.';
  end if;
  if exists (
    select 1 from public.products as products
    where products.id = any(v_product_ids)
      and (products.sale_type <> 'auction' or products.status <> 'closed')
  ) then
    raise exception using errcode = '55000', message = '마감된 경매 상품만 강제 결제완료 처리할 수 있습니다.';
  end if;
  if exists (
    select 1 from public.auction_purchase_offers as offers
    where offers.product_id = any(v_product_ids)
      and offers.id <> all(coalesce(v_offer_ids, '{}'::uuid[]))
      and offers.status = 'settled'
  ) then
    raise exception using errcode = '55000', message = '차순위 또는 다른 낙찰자의 결제가 이미 완료된 상품이 있습니다.';
  end if;

  v_before := jsonb_build_object(
    'request', to_jsonb(v_request),
    'orders', coalesce((
      select jsonb_agg(to_jsonb(orders) order by orders.id)
      from public.manual_transfer_orders as orders
      where orders.id = any(v_request.order_ids)
    ), '[]'::jsonb),
    'offers', coalesce((
      select jsonb_agg(to_jsonb(offers) order by offers.id)
      from public.auction_purchase_offers as offers
      where offers.product_id = any(v_product_ids)
    ), '[]'::jsonb)
  );

  perform set_config('app.owner_force_ledger', 'on', true);

  -- Revoke any uncompleted successor offer before restoring the original paid
  -- purchase. Settled successors were rejected above.
  update public.manual_transfer_orders as orders
  set status = 'owner_reversed',
      cancelled_at = v_now,
      cancellation_reason = left('원 낙찰자 강제 결제완료: ' || v_reason, 200)
  where orders.purchase_offer_id in (
    select offers.id from public.auction_purchase_offers as offers
    where offers.product_id = any(v_product_ids)
      and offers.offer_kind = 'second_chance'
      and offers.id <> all(coalesce(v_offer_ids, '{}'::uuid[]))
      and offers.status <> 'settled'
  )
    and orders.status <> 'confirmed';

  update public.auction_purchase_offers as offers
  set status = 'owner_reversed', updated_at = v_now
  where offers.product_id = any(v_product_ids)
    and offers.offer_kind = 'second_chance'
    and offers.id <> all(coalesce(v_offer_ids, '{}'::uuid[]))
    and offers.status <> 'settled';

  -- Void the system-generated late-payment warning and cancel only the active
  -- sanction linked to this mistakenly expired offer. History stays auditable.
  update public.member_warnings as warnings
  set voided_at = v_now,
      voided_by = v_actor,
      void_reason = left('소유자 강제 결제완료: ' || v_reason, 500)
  where warnings.id in (
    select penalties.warning_id from public.auction_offer_penalties as penalties
    where penalties.offer_id = any(coalesce(v_offer_ids, '{}'::uuid[]))
  )
    and warnings.voided_at is null;
  get diagnostics v_warning_count = row_count;

  update public.member_bid_sanctions as sanctions
  set status = 'cancelled',
      cancelled_by = v_actor,
      cancelled_at = v_now,
      cancellation_reason = left('소유자 강제 결제완료: ' || v_reason, 500),
      updated_by = v_actor,
      updated_at = v_now
  where sanctions.warning_id in (
    select penalties.warning_id from public.auction_offer_penalties as penalties
    where penalties.offer_id = any(coalesce(v_offer_ids, '{}'::uuid[]))
  )
    and sanctions.status = 'active';

  update public.auction_purchase_offers as offers
  set status = 'payment_due', payment_due_at = null, updated_at = v_now
  where offers.id = any(coalesce(v_offer_ids, '{}'::uuid[]))
    and offers.status in ('expired_unpaid', 'payment_due', 'accepted');

  update public.manual_transfer_orders as orders
  set status = 'awaiting_manual_transfer',
      due_at = null,
      display_due_at = null,
      cancelled_at = null,
      cancellation_reason = null,
      settlement_disposition = v_disposition,
      owner_forced_confirmed_at = v_now,
      owner_forced_confirmed_by = v_actor,
      owner_forced_confirmation_reason = v_reason
  where orders.id = any(v_request.order_ids);

  if v_request.shipping_fee_payment_id is not null then
    update public.shipping_fee_payments
    set status = 'awaiting_transfer', confirmed_at = null, confirmed_by = null
    where id = v_request.shipping_fee_payment_id
      and status in ('awaiting_transfer', 'partially_paid', 'cancelled');
  end if;

  for v_order in
    select orders.* from public.manual_transfer_orders as orders
    where orders.id = any(v_request.order_ids)
    order by orders.id
  loop
    select coalesce(sum(case when ledger.entry_type = 'receipt' then ledger.amount else -ledger.amount end), 0)::bigint
    into v_received
    from public.manual_transfer_payment_ledger as ledger
    where ledger.manual_transfer_order_id = v_order.id;
    if v_received < 0 or v_received > v_order.expected_amount then
      raise exception using errcode = '22023', message = '낙찰품 입금 원장 잔액이 결제 예정액과 맞지 않습니다.';
    end if;
    v_remaining := v_order.expected_amount - v_received;
    if v_remaining > 0 then
      v_child_hash := md5(p_idempotency_key::text || ':auction:' || v_order.id::text);
      v_child_key := substr(v_child_hash,1,8)||'-'||substr(v_child_hash,9,4)||'-4'||substr(v_child_hash,14,3)||'-a'||substr(v_child_hash,18,3)||'-'||substr(v_child_hash,21,12);
      insert into public.manual_transfer_payment_ledger (
        transfer_kind, manual_transfer_order_id, entry_type, amount,
        depositor_name, memo, recorded_by, idempotency_key
      ) values (
        'auction', v_order.id, 'receipt', v_remaining,
        v_name, '소유자 강제 결제완료: ' || left(v_reason, 160), v_actor, v_child_key
      );
    end if;

    update public.manual_transfer_orders
    set status = 'confirmed', confirmed_at = v_now, confirmed_by = v_actor
    where id = v_order.id and status = 'awaiting_manual_transfer';
    if not found then
      raise exception using errcode = 'PT409', message = '다른 작업이 낙찰 주문 상태를 변경했습니다.';
    end if;

    update public.customer_inventory_items
    set settlement_disposition = v_disposition,
        settlement_disposition_reason = v_reason,
        updated_at = v_now
    where manual_transfer_order_id = v_order.id;
  end loop;

  if v_request.shipping_fee_payment_id is not null then
    select payments.* into v_shipping
    from public.shipping_fee_payments as payments
    where payments.id = v_request.shipping_fee_payment_id;
    if v_shipping.id is not null and v_shipping.status = 'awaiting_transfer' then
      select coalesce(sum(case when ledger.entry_type = 'receipt' then ledger.amount else -ledger.amount end), 0)::bigint
      into v_received
      from public.manual_transfer_payment_ledger as ledger
      where ledger.shipping_fee_payment_id = v_shipping.id;
      if v_received < 0 or v_received > v_shipping.expected_amount then
        raise exception using errcode = '22023', message = '배송비 입금 원장 잔액이 결제 예정액과 맞지 않습니다.';
      end if;
      v_remaining := v_shipping.expected_amount - v_received;
      if v_remaining > 0 then
        v_child_hash := md5(p_idempotency_key::text || ':shipping:' || v_shipping.id::text);
        v_child_key := substr(v_child_hash,1,8)||'-'||substr(v_child_hash,9,4)||'-4'||substr(v_child_hash,14,3)||'-a'||substr(v_child_hash,18,3)||'-'||substr(v_child_hash,21,12);
        insert into public.manual_transfer_payment_ledger (
          transfer_kind, shipping_fee_payment_id, entry_type, amount,
          depositor_name, memo, recorded_by, idempotency_key
        ) values (
          'shipping', v_shipping.id, 'receipt', v_remaining,
          v_name, '소유자 강제 결제완료 배송비', v_actor, v_child_key
        );
      end if;
      insert into public.shipping_fee_waiver_entitlements (
        member_id, business_id, exception_case_id, commerce_order_id,
        auction_bundle_payment_id, prepaid_amount
      )
      select v_shipping.member_id, (entry.value ->> 'businessId')::uuid,
        null, null, v_shipping.id, (entry.value ->> 'amount')::bigint
      from jsonb_array_elements(v_shipping.fee_breakdown) as entry
      where (entry.value ->> 'amount')::bigint > 0
      on conflict (auction_bundle_payment_id, business_id)
        where auction_bundle_payment_id is not null
      do nothing;
      update public.shipping_fee_payments
      set status = 'confirmed', confirmed_at = v_now, confirmed_by = v_actor,
          depositor_name = v_name
      where id = v_shipping.id and status = 'awaiting_transfer';
    end if;
  end if;

  update public.auction_payment_confirmation_requests
  set status = 'resolved', resolved_at = v_now, resolution = 'confirmed',
      version = version + 1
  where id = v_request.id;
  insert into public.auction_payment_confirmation_request_events (
    request_id, event_kind, actor_user_id, metadata
  ) values (
    v_request.id, 'resolved', v_actor,
    jsonb_build_object('resolution', 'confirmed', 'forced', true,
      'settlementDisposition', v_disposition, 'reason', v_reason)
  );

  v_result := jsonb_build_object(
    'requestId', v_request.id,
    'memberId', v_request.member_id,
    'orderCount', cardinality(v_request.order_ids),
    'status', 'confirmed',
    'settlementDisposition', v_disposition,
    'voidedWarningCount', v_warning_count,
    'confirmedAt', v_now,
    'idempotentReplay', false
  );
  insert into public.owner_forced_payment_confirmations (
    actor_owner_id, request_id, member_id, order_ids,
    settlement_disposition, depositor_name, reason, idempotency_key,
    request_fingerprint, before_state, result
  ) values (
    v_actor, v_request.id, v_request.member_id, v_request.order_ids,
    v_disposition, v_name, v_reason, p_idempotency_key,
    v_fingerprint, v_before, v_result
  );

  perform app_private.write_security_activity(
    v_actor, v_request.member_id, 'payment', 'owner_forced_payment_confirmation',
    'approve', 'owner_force_confirm_auction_payment_request', 'payment_request',
    v_request.id::text, 'critical', null, null,
    jsonb_build_object('reason', v_reason, 'orderIds', v_request.order_ids,
      'settlementDisposition', v_disposition, 'voidedWarningCount', v_warning_count),
    v_now
  );
  return v_result;
end;
$$;

revoke all on function public.owner_force_confirm_auction_payment_request(uuid,bigint,text,boolean,text,uuid)
from public, anon, authenticated, service_role;
grant execute on function public.owner_force_confirm_auction_payment_request(uuid,bigint,text,boolean,text,uuid)
to authenticated;

-- Corrected system warnings must not count toward later automatic sanctions.
create or replace function app_private.apply_system_late_payment_warning(
  p_offer_id uuid,
  p_member_id uuid,
  p_now timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_warning_count integer;
  v_sanction_count integer;
  v_blocked_until timestamptz;
  v_warning_id uuid;
  v_sanction_id uuid;
  v_sanction_round integer;
  v_lock_key bigint;
begin
  if p_offer_id is null or p_member_id is null or p_now is null then return null; end if;
  if public.is_payment_deadline_exempt(p_member_id)
    or public.is_owner_hidden_test_member(p_member_id) then return null; end if;

  select penalties.warning_id, sanctions.id into v_warning_id, v_sanction_id
  from public.auction_offer_penalties as penalties
  left join public.member_bid_sanctions as sanctions on sanctions.warning_id = penalties.warning_id
  where penalties.offer_id = p_offer_id;
  if v_warning_id is not null then return v_sanction_id; end if;

  v_lock_key := hashtextextended('member-warning-enforcement:' || p_member_id::text, 0);
  perform pg_advisory_xact_lock(v_lock_key);
  if coalesce(public.access_role_for_user(p_member_id), '') not in ('member', 'band_member')
    or public.is_payment_deadline_exempt(p_member_id)
    or public.is_owner_hidden_test_member(p_member_id) then return null; end if;

  select penalties.warning_id, sanctions.id into v_warning_id, v_sanction_id
  from public.auction_offer_penalties as penalties
  left join public.member_bid_sanctions as sanctions on sanctions.warning_id = penalties.warning_id
  where penalties.offer_id = p_offer_id;
  if v_warning_id is not null then return v_sanction_id; end if;

  select count(*)::integer into v_warning_count
  from public.member_warnings as warnings
  where warnings.member_id = p_member_id and warnings.voided_at is null;
  select count(*)::integer, max(sanctions.ends_at)
  into v_sanction_count, v_blocked_until
  from public.member_bid_sanctions as sanctions
  where sanctions.member_id = p_member_id and sanctions.status <> 'cancelled';

  v_warning_count := v_warning_count + 1;
  insert into public.member_warnings (
    member_id, category, reason, warning_number, created_by, created_at
  ) values (
    p_member_id, 'late_payment', '낙찰 상품 계좌이체 기한 미준수',
    v_warning_count, null, p_now
  ) returning id into v_warning_id;
  insert into public.auction_offer_penalties (offer_id, warning_id, created_at)
  values (p_offer_id, v_warning_id, p_now);

  if mod(v_warning_count, 3) = 0 then
    v_sanction_round := v_sanction_count + 1;
    v_blocked_until := greatest(p_now, coalesce(v_blocked_until, p_now))
      + make_interval(days => v_sanction_round);
    insert into public.member_bid_sanctions (
      member_id, warning_id, sanction_round, starts_at, ends_at
    ) values (
      p_member_id, v_warning_id, v_sanction_round, p_now, v_blocked_until
    ) returning id into v_sanction_id;
    perform public.cancel_member_active_bids(p_member_id, v_sanction_id, p_now);
  end if;
  return v_sanction_id;
end;
$$;

revoke all on function app_private.apply_system_late_payment_warning(uuid,uuid,timestamptz)
from public, anon, authenticated, service_role;

-- Excluded forced confirmations still create the buyer's inventory entitlement,
-- but item-sale and commission entries are not projected into seller payouts.
create or replace function app_private.project_shipped_store_settlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'shipped' and old.status is distinct from 'shipped' then
    insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_id,source_key,metadata)
    select items.origin_store_id,'item_sale',inventory.paid_amount,new.shipped_at,'inventory_item',inventory.id,
      'item-sale:'||inventory.id::text,jsonb_build_object('shipmentId',new.id,'productId',inventory.product_id,'settlementDisposition',inventory.settlement_disposition)
    from public.inventory_shipment_items items join public.customer_inventory_items inventory on inventory.id=items.inventory_item_id
    where items.shipment_id=new.id and items.line_status in ('packed','shipped','ready')
      and inventory.settlement_disposition='included'
    on conflict(source_key) do nothing;

    insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_id,source_key,metadata)
    select items.origin_store_id,'commission',-ceil(inventory.paid_amount*r.rate)::bigint,new.shipped_at,
      'inventory_item',inventory.id,'item-commission:'||inventory.id::text,
      jsonb_build_object('rate',r.rate,'planSnapshot','standard','rounding','ceil','shipmentId',new.id,'settlementDisposition',inventory.settlement_disposition)
    from public.inventory_shipment_items items join public.customer_inventory_items inventory on inventory.id=items.inventory_item_id
    cross join lateral (select app_private.store_commission_rate(items.origin_store_id,new.shipped_at) rate) r
    where items.shipment_id=new.id and items.line_status in ('packed','shipped','ready')
      and inventory.settlement_disposition='included'
    on conflict(source_key) do nothing;

    insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_id,source_key,metadata)
    select distinct allocations.billing_store_id,'shipping_fee',allocations.amount,new.shipped_at,'shipping_allocation',allocations.id,
      'shipping-fee:'||allocations.id::text,allocations.policy_snapshot||jsonb_build_object('shipmentId',new.id)
    from public.inventory_shipment_items shipment_items join public.customer_inventory_items inventory on inventory.id=shipment_items.inventory_item_id
    join public.commerce_order_items order_items on order_items.id=inventory.commerce_order_item_id
    join public.commerce_order_shipping_fee_allocations allocations on allocations.order_id=order_items.order_id
      and (allocations.charge_mode='per_group' or allocations.origin_store_id=shipment_items.origin_store_id)
    where shipment_items.shipment_id=new.id on conflict(source_key) do nothing;

    insert into public.store_settlement_entries(store_id,entry_kind,amount,eligible_at,source_kind,source_id,source_key,metadata)
    select distinct allocations.billing_store_id,'commission',-ceil(allocations.amount*r.rate)::bigint,new.shipped_at,
      'shipping_allocation',allocations.id,'shipping-commission:'||allocations.id::text,
      jsonb_build_object('rate',r.rate,'planSnapshot','standard','rounding','ceil','shipmentId',new.id)
    from public.inventory_shipment_items shipment_items join public.customer_inventory_items inventory on inventory.id=shipment_items.inventory_item_id
    join public.commerce_order_items order_items on order_items.id=inventory.commerce_order_item_id
    join public.commerce_order_shipping_fee_allocations allocations on allocations.order_id=order_items.order_id
      and (allocations.charge_mode='per_group' or allocations.origin_store_id=shipment_items.origin_store_id)
    cross join lateral (select app_private.store_commission_rate(allocations.billing_store_id,new.shipped_at) rate) r
    where shipment_items.shipment_id=new.id on conflict(source_key) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function app_private.project_shipped_store_settlement()
from public, anon, authenticated, service_role;

comment on function public.operator_process_second_chance_manual(uuid) is
  'Owner/operator selected-store manual creation of the one permitted second-chance offer; scheduled expiry never creates it.';
comment on function public.owner_force_confirm_auction_payment_request(uuid,bigint,text,boolean,text,uuid) is
  'Owner-only audited recovery of an expired auction bank-transfer request with explicit seller-settlement inclusion or exclusion.';

commit;
