begin;

set local lock_timeout = '10s';

-- The customer-facing policy allows the original winner to pay until 23:59:59
-- KST on the third calendar day after the auction closes. The original seed
-- accidentally used hour 11 and only one calendar day.
alter table public.auction_revenue_defense_settings
  alter column original_payment_hour set default 23;

update public.auction_revenue_defense_settings
set original_payment_hour = 23,
    original_payment_minute = 59
where singleton
  and (original_payment_hour, original_payment_minute) is distinct from (23, 59);

create or replace function app_private.original_manual_payment_due_at(
  p_closed_at timestamptz,
  p_now timestamptz default clock_timestamp()
)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select greatest(
    (
      (p_closed_at at time zone 'Asia/Seoul')::date
      + 3
      + make_time(
          settings.original_payment_hour,
          settings.original_payment_minute,
          59
        )
    ) at time zone 'Asia/Seoul',
    p_now + interval '1 hour'
  )
  from public.auction_revenue_defense_settings as settings
  where settings.singleton;
$$;

revoke all on function app_private.original_manual_payment_due_at(
  timestamptz, timestamptz
) from public, anon, authenticated, service_role;

-- Correct every still-live original-winner deadline from the product close
-- timestamp. Expired/cancelled rows are deliberately not revived.
with corrected as (
  update public.auction_purchase_offers as offers
  set payment_due_at = app_private.original_manual_payment_due_at(
        products.closes_at,
        clock_timestamp()
      ),
      display_payment_due_at = app_private.original_manual_payment_due_at(
        products.closes_at,
        clock_timestamp()
      )
  from public.products as products
  where offers.status in ('payment_due', 'accepted')
    and offers.product_id = products.id
    and offers.payment_due_at > clock_timestamp()
  returning offers.id, offers.payment_due_at
)
update public.manual_transfer_orders as orders
set due_at = corrected.payment_due_at,
    display_due_at = corrected.payment_due_at
from corrected
where orders.purchase_offer_id = corrected.id
  and orders.status = 'awaiting_manual_transfer'
  and orders.payment_deadline_held_at is null;

create table public.auction_payment_confirmation_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete restrict,
  batch_key text not null unique check (char_length(batch_key) between 32 and 80),
  request_kind text not null default 'buyer' check (
    request_kind in ('buyer', 'system_reconciliation')
  ),
  order_ids uuid[] not null check (cardinality(order_ids) between 1 and 100),
  shipping_fee_payment_id uuid references public.shipping_fee_payments(id) on delete restrict,
  expected_amount bigint not null check (expected_amount between 1 and 100000000000),
  depositor_name text not null check (char_length(btrim(depositor_name)) between 1 and 80),
  status text not null default 'open' check (status in ('open', 'resolved')),
  first_requested_at timestamptz not null default clock_timestamp(),
  last_requested_at timestamptz not null default clock_timestamp(),
  reminder_count integer not null default 0 check (reminder_count between 0 and 1000),
  original_due_at timestamptz,
  review_due_at timestamptz,
  resolved_at timestamptz,
  resolution text check (resolution is null or resolution in ('confirmed', 'cancelled', 'not_found')),
  version bigint not null default 0 check (version >= 0),
  check (
    (status = 'open' and resolved_at is null and resolution is null)
    or (status = 'resolved' and resolved_at is not null and resolution is not null)
  )
);

create table public.auction_payment_confirmation_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.auction_payment_confirmation_requests(id) on delete restrict,
  event_kind text not null check (event_kind in ('requested', 'reminded', 'detected', 'resolved')),
  actor_user_id uuid references public.profiles(id) on delete restrict,
  idempotency_key uuid,
  occurred_at timestamptz not null default clock_timestamp(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  unique (request_id, idempotency_key)
);

create index auction_payment_confirmation_requests_owner_queue_idx
on public.auction_payment_confirmation_requests(status, last_requested_at, first_requested_at);

create index auction_payment_confirmation_request_events_request_idx
on public.auction_payment_confirmation_request_events(request_id, occurred_at, id);

alter table public.auction_payment_confirmation_requests enable row level security;
alter table public.auction_payment_confirmation_requests force row level security;
alter table public.auction_payment_confirmation_request_events enable row level security;
alter table public.auction_payment_confirmation_request_events force row level security;

revoke all on table public.auction_payment_confirmation_requests
from public, anon, authenticated, service_role;
revoke all on table public.auction_payment_confirmation_request_events
from public, anon, authenticated, service_role;
grant select on table public.auction_payment_confirmation_requests to authenticated, service_role;
grant select on table public.auction_payment_confirmation_request_events to service_role;

create policy "Members read their auction payment confirmation requests"
on public.auction_payment_confirmation_requests
for select to authenticated
using (member_id = auth.uid() or public.is_owner());

create policy "Service reads auction payment confirmation requests"
on public.auction_payment_confirmation_requests
for select to service_role using (true);

create policy "Service reads auction payment confirmation request events"
on public.auction_payment_confirmation_request_events
for select to service_role using (true);

create or replace function public.request_my_combined_auction_payment_confirmation(
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
  v_order_ids uuid[];
  v_offer_ids uuid[];
  v_expected bigint;
  v_depositor_name text;
  v_original_due_at timestamptz;
  v_review_due_at timestamptz := v_now + interval '24 hours';
  v_shipping public.shipping_fee_payments%rowtype;
  v_request public.auction_payment_confirmation_requests%rowtype;
  v_batch_key text;
  v_event_kind text;
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

  perform orders.id
  from public.manual_transfer_orders as orders
  where orders.id = any(p_order_ids)
  order by orders.id
  for update;

  select
    array_agg(orders.id order by orders.id),
    array_agg(orders.purchase_offer_id order by orders.id)
      filter (where orders.purchase_offer_id is not null),
    sum(orders.expected_amount)::bigint,
    min(coalesce(orders.display_due_at, orders.due_at))
  into v_order_ids, v_offer_ids, v_expected, v_original_due_at
  from public.manual_transfer_orders as orders
  where orders.id = any(p_order_ids)
    and orders.buyer_id = v_actor
    and orders.status = 'awaiting_manual_transfer';

  if coalesce(cardinality(v_order_ids), 0) <> cardinality(p_order_ids) then
    raise exception using errcode = 'P0002', message = '입금 대기 중인 낙찰 결제 묶음을 찾지 못했습니다.';
  end if;

  select nullif(btrim(accounts.last_depositor_name), '')
  into v_depositor_name
  from public.member_accounts as accounts
  where accounts.member_id = v_actor;
  if v_depositor_name is null then
    raise exception using errcode = '55000', message = '입금자명을 먼저 입력해 주세요.';
  end if;

  select payments.*
  into v_shipping
  from public.shipping_fee_payments as payments
  where payments.member_id = v_actor
    and payments.payment_context = 'auction_bundle'
    and payments.status in ('awaiting_transfer', 'partially_paid')
  for update;

  v_expected := v_expected + coalesce(v_shipping.expected_amount, 0);
  v_batch_key := md5(v_actor::text || ':' || array_to_string(v_order_ids, ','));

  select requests.*
  into v_request
  from public.auction_payment_confirmation_requests as requests
  where requests.batch_key = v_batch_key
  for update;

  if found then
    if exists (
      select 1
      from public.auction_payment_confirmation_request_events as events
      where events.request_id = v_request.id
        and events.idempotency_key = p_idempotency_key
    ) then
      return jsonb_build_object(
        'id', v_request.id,
        'status', v_request.status,
        'firstRequestedAt', v_request.first_requested_at,
        'lastRequestedAt', v_request.last_requested_at,
        'reminderCount', v_request.reminder_count,
        'reviewDueAt', v_request.review_due_at,
        'replayed', true
      );
    end if;
    if v_request.status = 'resolved' then
      raise exception using errcode = '55000', message = '이미 처리된 입금 확인 요청입니다.';
    end if;
    if v_request.last_requested_at > v_now - interval '5 minutes' then
      raise exception using errcode = '55000', message = '입금 확인 재요청은 5분 후에 할 수 있습니다.';
    end if;
    update public.auction_payment_confirmation_requests
    set last_requested_at = v_now,
        reminder_count = reminder_count + 1,
        version = version + 1
    where id = v_request.id
    returning * into v_request;
    v_event_kind := 'reminded';
  else
    insert into public.auction_payment_confirmation_requests (
      member_id, batch_key, request_kind, order_ids,
      shipping_fee_payment_id, expected_amount, depositor_name,
      first_requested_at, last_requested_at, original_due_at, review_due_at
    ) values (
      v_actor, v_batch_key, 'buyer', v_order_ids,
      v_shipping.id, v_expected, v_depositor_name,
      v_now, v_now, v_original_due_at, v_review_due_at
    ) returning * into v_request;
    v_event_kind := 'requested';

    -- A buyer's declaration never confirms money. It only gives the owner a
    -- bounded reconciliation window so the automatic expiry cannot hide it.
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
  end if;

  insert into public.auction_payment_confirmation_request_events (
    request_id, event_kind, actor_user_id, idempotency_key, metadata
  ) values (
    v_request.id, v_event_kind, v_actor, p_idempotency_key,
    jsonb_build_object(
      'expectedAmount', v_expected,
      'orderCount', cardinality(v_order_ids),
      'shippingFeePaymentId', v_shipping.id
    )
  );

  for v_owner_id in
    select roles.user_id
    from public.account_access_roles as roles
    where roles.role_code = 'owner'
  loop
    perform app_private.insert_targeted_notification(
      v_owner_id,
      'owner',
      'payment_verification_requested',
      case when v_event_kind = 'reminded'
        then '낙찰품 입금 확인 재요청이 있습니다'
        else '낙찰품 입금 확인 요청이 있습니다'
      end,
      v_depositor_name || ' 명의의 ' || v_expected::text || '원 입금 여부를 확인해 주세요.',
      '/admin/owner/payments?queue=auction-confirmation-requests'
    );
  end loop;

  return jsonb_build_object(
    'id', v_request.id,
    'status', v_request.status,
    'firstRequestedAt', v_request.first_requested_at,
    'lastRequestedAt', v_request.last_requested_at,
    'reminderCount', v_request.reminder_count,
    'reviewDueAt', v_request.review_due_at,
    'replayed', false
  );
end;
$$;

revoke all on function public.request_my_combined_auction_payment_confirmation(uuid[], uuid)
from public, anon, authenticated, service_role;
grant execute on function public.request_my_combined_auction_payment_confirmation(uuid[], uuid)
to authenticated;

create or replace function app_private.resolve_auction_payment_confirmation_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.auction_payment_confirmation_requests as requests
  set status = 'resolved',
      resolved_at = clock_timestamp(),
      resolution = case
        when not exists (
          select 1 from public.manual_transfer_orders as orders
          where orders.id = any(requests.order_ids)
            and orders.status <> 'confirmed'
        ) and (
          requests.shipping_fee_payment_id is null
          or exists (
            select 1 from public.shipping_fee_payments as payments
            where payments.id = requests.shipping_fee_payment_id
              and payments.status = 'confirmed'
          )
        ) then 'confirmed'
        else 'cancelled'
      end,
      version = version + 1
  where requests.status = 'open'
    and (
      (tg_table_name = 'manual_transfer_orders' and new.id = any(requests.order_ids))
      or (
        tg_table_name = 'shipping_fee_payments'
        and requests.shipping_fee_payment_id = new.id
      )
    )
    and not exists (
      select 1 from public.manual_transfer_orders as orders
      where orders.id = any(requests.order_ids)
        and orders.status = 'awaiting_manual_transfer'
    )
    and (
      requests.shipping_fee_payment_id is null
      or not exists (
        select 1 from public.shipping_fee_payments as payments
        where payments.id = requests.shipping_fee_payment_id
          and payments.status in ('awaiting_transfer', 'partially_paid')
      )
    );
  return new;
end;
$$;

revoke all on function app_private.resolve_auction_payment_confirmation_request()
from public, anon, authenticated, service_role;

create trigger manual_transfer_orders_resolve_auction_confirmation_request
after update of status on public.manual_transfer_orders
for each row execute function app_private.resolve_auction_payment_confirmation_request();

create trigger shipping_fee_payments_resolve_auction_confirmation_request
after update of status on public.shipping_fee_payments
for each row execute function app_private.resolve_auction_payment_confirmation_request();

create or replace function public.get_owner_auction_payment_confirmation_queue()
returns table (
  request_id uuid,
  request_kind text,
  buyer_display_name text,
  depositor_name text,
  expected_amount bigint,
  order_count integer,
  item_reference text,
  first_requested_at timestamptz,
  last_requested_at timestamptz,
  reminder_count integer,
  original_due_at timestamptz,
  review_due_at timestamptz,
  has_cancelled_orders boolean,
  request_version bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  return query
  select
    requests.id,
    requests.request_kind,
    profiles.display_name,
    requests.depositor_name,
    requests.expected_amount,
    cardinality(requests.order_ids),
    coalesce(items.reference, '낙찰품 결제')::text,
    requests.first_requested_at,
    requests.last_requested_at,
    requests.reminder_count,
    requests.original_due_at,
    requests.review_due_at,
    coalesce(items.has_cancelled, false),
    requests.version
  from public.auction_payment_confirmation_requests as requests
  join public.profiles as profiles on profiles.id = requests.member_id
  left join lateral (
    select
      string_agg(orders.order_name, ', ' order by orders.requested_at, orders.id) as reference,
      bool_or(orders.status = 'cancelled_unpaid') as has_cancelled
    from public.manual_transfer_orders as orders
    where orders.id = any(requests.order_ids)
  ) as items on true
  where requests.status = 'open'
  order by
    (requests.request_kind = 'system_reconciliation') desc,
    requests.reminder_count desc,
    requests.first_requested_at asc;
end;
$$;

revoke all on function public.get_owner_auction_payment_confirmation_queue()
from public, anon, authenticated, service_role;
grant execute on function public.get_owner_auction_payment_confirmation_queue()
to authenticated;

create or replace function public.owner_resolve_auction_payment_confirmation_request(
  p_request_id uuid,
  p_expected_version bigint,
  p_resolution text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_request public.auction_payment_confirmation_requests%rowtype;
begin
  if v_actor is null or not public.is_owner() then
    raise exception using errcode = '42501', message = '소유자 권한이 필요합니다.';
  end if;
  if p_request_id is null or p_expected_version is null
    or p_resolution not in ('cancelled', 'not_found')
  then
    raise exception using errcode = '22023', message = '입금 확인 요청 처리값을 확인해 주세요.';
  end if;

  update public.auction_payment_confirmation_requests
  set status = 'resolved',
      resolved_at = clock_timestamp(),
      resolution = p_resolution,
      version = version + 1
  where id = p_request_id
    and status = 'open'
    and version = p_expected_version
  returning * into v_request;
  if not found then
    raise exception using errcode = 'PT409', message = '입금 확인 요청 상태가 변경되었습니다.';
  end if;

  insert into public.auction_payment_confirmation_request_events (
    request_id, event_kind, actor_user_id, metadata
  ) values (
    v_request.id, 'resolved', v_actor, jsonb_build_object('resolution', p_resolution)
  );

  return jsonb_build_object(
    'id', v_request.id,
    'status', v_request.status,
    'resolution', v_request.resolution,
    'version', v_request.version
  );
end;
$$;

revoke all on function public.owner_resolve_auction_payment_confirmation_request(uuid, bigint, text)
from public, anon, authenticated, service_role;
grant execute on function public.owner_resolve_auction_payment_confirmation_request(uuid, bigint, text)
to authenticated;

-- Surface recent orphaned auction shipping bundles as reconciliation-only
-- alerts. This does not mark any payment paid and never revives an auction.
with candidates as (
  select
    payments.id as shipping_payment_id,
    payments.member_id,
    payments.expected_amount as shipping_amount,
    payments.requested_at,
    accounts.last_depositor_name,
    array_agg(orders.id order by orders.id) as order_ids,
    sum(orders.expected_amount)::bigint as item_amount,
    min(coalesce(orders.display_due_at, orders.due_at)) as original_due_at
  from public.shipping_fee_payments as payments
  join public.member_accounts as accounts on accounts.member_id = payments.member_id
  join public.manual_transfer_orders as orders
    on orders.buyer_id = payments.member_id
   and orders.status = 'cancelled_unpaid'
   and orders.cancelled_at >= payments.requested_at
   and orders.requested_at between payments.requested_at - interval '1 hour'
                               and payments.requested_at + interval '1 hour'
  where payments.payment_context = 'auction_bundle'
    and payments.status in ('awaiting_transfer', 'partially_paid')
    and payments.requested_at >= clock_timestamp() - interval '7 days'
    and nullif(btrim(accounts.last_depositor_name), '') is not null
    and not exists (
      select 1 from public.manual_transfer_payment_ledger as ledger
      where ledger.shipping_fee_payment_id = payments.id
    )
  group by payments.id, accounts.last_depositor_name
)
insert into public.auction_payment_confirmation_requests (
  member_id, batch_key, request_kind, order_ids, shipping_fee_payment_id,
  expected_amount, depositor_name, first_requested_at, last_requested_at,
  original_due_at, review_due_at
)
select
  candidates.member_id,
  md5('system:' || candidates.member_id::text || ':' || array_to_string(candidates.order_ids, ',')),
  'system_reconciliation',
  candidates.order_ids,
  candidates.shipping_payment_id,
  candidates.item_amount + candidates.shipping_amount,
  btrim(candidates.last_depositor_name),
  candidates.requested_at,
  candidates.requested_at,
  candidates.original_due_at,
  clock_timestamp()
from candidates
on conflict (batch_key) do nothing;

insert into public.auction_payment_confirmation_request_events (
  request_id, event_kind, metadata
)
select requests.id, 'detected', jsonb_build_object(
  'reason', 'orphan_auction_bundle_after_unpaid_expiry',
  'expectedAmount', requests.expected_amount
)
from public.auction_payment_confirmation_requests as requests
where requests.request_kind = 'system_reconciliation'
  and not exists (
    select 1 from public.auction_payment_confirmation_request_events as events
    where events.request_id = requests.id
  );

comment on table public.auction_payment_confirmation_requests is
  'Buyer declarations and system-detected auction payment reconciliation alerts. A request never confirms receipt by itself.';

commit;
