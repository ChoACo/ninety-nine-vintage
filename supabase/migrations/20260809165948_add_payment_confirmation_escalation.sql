begin;

set local lock_timeout = '10s';

create table public.commerce_payment_confirmation_requests (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null unique references public.commerce_order_transfers(id) on delete restrict,
  order_id uuid not null unique references public.commerce_orders(id) on delete restrict,
  member_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'resolved')),
  first_requested_at timestamptz not null default clock_timestamp(),
  last_requested_at timestamptz not null default clock_timestamp(),
  reminder_count integer not null default 0 check (reminder_count between 0 and 1000),
  resolved_at timestamptz,
  resolution text check (resolution is null or resolution in ('confirmed', 'cancelled')),
  version bigint not null default 0 check (version >= 0),
  check (
    (status = 'open' and resolved_at is null and resolution is null)
    or (status = 'resolved' and resolved_at is not null and resolution is not null)
  )
);

create table public.commerce_payment_confirmation_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.commerce_payment_confirmation_requests(id) on delete restrict,
  event_kind text not null check (event_kind in ('requested', 'reminded', 'resolved')),
  actor_user_id uuid references public.profiles(id) on delete restrict,
  occurred_at timestamptz not null default clock_timestamp(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

create index commerce_payment_confirmation_requests_owner_queue_idx
on public.commerce_payment_confirmation_requests(status, last_requested_at, first_requested_at);

create index commerce_payment_confirmation_request_events_request_idx
on public.commerce_payment_confirmation_request_events(request_id, occurred_at, id);

alter table public.commerce_payment_confirmation_requests enable row level security;
alter table public.commerce_payment_confirmation_requests force row level security;
alter table public.commerce_payment_confirmation_request_events enable row level security;
alter table public.commerce_payment_confirmation_request_events force row level security;

revoke all on table public.commerce_payment_confirmation_requests
from public, anon, authenticated, service_role;
revoke all on table public.commerce_payment_confirmation_request_events
from public, anon, authenticated, service_role;
grant select on table public.commerce_payment_confirmation_requests to authenticated, service_role;
grant select on table public.commerce_payment_confirmation_request_events to service_role;

create policy "Members read their payment confirmation request"
on public.commerce_payment_confirmation_requests
for select to authenticated
using (member_id = auth.uid() or public.is_owner());

create policy "Service reads payment confirmation requests"
on public.commerce_payment_confirmation_requests
for select to service_role using (true);

create policy "Service reads payment confirmation request events"
on public.commerce_payment_confirmation_request_events
for select to service_role using (true);

create or replace function public.request_commerce_payment_confirmation(
  p_order_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_transfer public.commerce_order_transfers%rowtype;
  v_request public.commerce_payment_confirmation_requests%rowtype;
  v_now timestamptz := clock_timestamp();
  v_event_kind text;
  v_owner_id uuid;
begin
  if v_actor is null or p_order_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = '입금 확인 요청을 확인해 주세요.';
  end if;

  select transfers.* into v_transfer
  from public.commerce_order_transfers as transfers
  join public.commerce_orders as orders on orders.id = transfers.order_id
  where transfers.order_id = p_order_id
    and transfers.member_id = v_actor
    and orders.member_id = v_actor
  for update of transfers;
  if not found then
    raise exception using errcode = 'P0002', message = '입금 대기 주문을 찾지 못했습니다.';
  end if;
  if v_transfer.status not in ('awaiting_transfer', 'partially_paid') then
    raise exception using errcode = '55000', message = '입금 확인 요청이 필요한 주문이 아닙니다.';
  end if;
  if v_transfer.requested_at > v_now - interval '12 hours' then
    raise exception using errcode = '55000', message = '입금 요청 후 12시간이 지나면 확인을 요청할 수 있습니다.';
  end if;

  select requests.* into v_request
  from public.commerce_payment_confirmation_requests as requests
  where requests.transfer_id = v_transfer.id
  for update;

  if found then
    if v_request.status = 'resolved' then
      raise exception using errcode = '55000', message = '이미 처리된 입금 확인 요청입니다.';
    end if;
    if exists (
      select 1
      from public.commerce_payment_confirmation_request_events as events
      where events.request_id = v_request.id
        and events.metadata ->> 'idempotencyKey' = p_idempotency_key::text
    ) then
      return jsonb_build_object(
        'id', v_request.id, 'status', v_request.status,
        'firstRequestedAt', v_request.first_requested_at,
        'lastRequestedAt', v_request.last_requested_at,
        'reminderCount', v_request.reminder_count,
        'replayed', true
      );
    end if;
    if v_request.last_requested_at > v_now - interval '1 hour' then
      raise exception using errcode = '55000', message = '입금 확인 재요청은 1시간 후에 할 수 있습니다.';
    end if;
    update public.commerce_payment_confirmation_requests
    set last_requested_at = v_now,
        reminder_count = reminder_count + 1,
        version = version + 1
    where id = v_request.id
    returning * into v_request;
    v_event_kind := 'reminded';
  else
    insert into public.commerce_payment_confirmation_requests(
      transfer_id, order_id, member_id, first_requested_at, last_requested_at
    ) values (
      v_transfer.id, v_transfer.order_id, v_actor, v_now, v_now
    ) returning * into v_request;
    v_event_kind := 'requested';
  end if;

  insert into public.commerce_payment_confirmation_request_events(
    request_id, event_kind, actor_user_id, metadata
  ) values (
    v_request.id, v_event_kind, v_actor,
    jsonb_build_object('idempotencyKey', p_idempotency_key, 'expectedAmount', v_transfer.expected_amount)
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
      case when v_event_kind = 'reminded' then '입금 확인 재요청이 있습니다' else '입금 확인 긴급 요청이 있습니다' end,
      '12시간 이상 대기한 주문의 입금 확인이 요청되었습니다.',
      '/admin/owner/payments?queue=confirmation-requests'
    );
  end loop;

  return jsonb_build_object(
    'id', v_request.id, 'status', v_request.status,
    'firstRequestedAt', v_request.first_requested_at,
    'lastRequestedAt', v_request.last_requested_at,
    'reminderCount', v_request.reminder_count,
    'replayed', false
  );
end;
$$;

revoke all on function public.request_commerce_payment_confirmation(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.request_commerce_payment_confirmation(uuid, uuid)
to authenticated;

create or replace function app_private.resolve_commerce_payment_confirmation_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
begin
  if new.status not in ('confirmed', 'cancelled') or old.status is not distinct from new.status then
    return new;
  end if;
  update public.commerce_payment_confirmation_requests
  set status = 'resolved', resolved_at = clock_timestamp(), resolution = new.status,
      version = version + 1
  where transfer_id = new.id and status = 'open'
  returning id into v_request_id;
  if v_request_id is not null then
    insert into public.commerce_payment_confirmation_request_events(
      request_id, event_kind, actor_user_id, metadata
    ) values (
      v_request_id, 'resolved', auth.uid(), jsonb_build_object('resolution', new.status)
    );
  end if;
  return new;
end;
$$;

revoke all on function app_private.resolve_commerce_payment_confirmation_request()
from public, anon, authenticated, service_role;

create trigger commerce_order_transfers_resolve_confirmation_request
after update of status on public.commerce_order_transfers
for each row execute function app_private.resolve_commerce_payment_confirmation_request();

create or replace function public.get_owner_payment_confirmation_queue()
returns table(
  request_id uuid,
  order_id uuid,
  buyer_display_name text,
  expected_amount bigint,
  transfer_status text,
  first_requested_at timestamptz,
  last_requested_at timestamptz,
  reminder_count integer,
  elapsed_seconds bigint,
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
  select requests.id, requests.order_id, profiles.display_name,
    transfers.expected_amount, transfers.status,
    requests.first_requested_at, requests.last_requested_at,
    requests.reminder_count,
    greatest(0, extract(epoch from clock_timestamp() - requests.first_requested_at)::bigint),
    requests.version
  from public.commerce_payment_confirmation_requests as requests
  join public.commerce_order_transfers as transfers on transfers.id = requests.transfer_id
  join public.profiles on profiles.id = requests.member_id
  where requests.status = 'open'
  order by requests.reminder_count desc, requests.first_requested_at asc;
end;
$$;

revoke all on function public.get_owner_payment_confirmation_queue()
from public, anon, authenticated, service_role;
grant execute on function public.get_owner_payment_confirmation_queue()
to authenticated;

comment on table public.commerce_payment_confirmation_request_events is
  'Append-only audit events for member escalation; never confirms a payment automatically.';

commit;
