begin;

create table public.inventory_shipment_address_access_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.inventory_shipments(id) on delete restrict,
  actor_user_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key uuid not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  accessed_at timestamptz not null default clock_timestamp(),
  unique (actor_user_id, idempotency_key)
);

create index inventory_shipment_address_access_events_shipment_idx
on public.inventory_shipment_address_access_events(shipment_id, accessed_at desc, id desc);

alter table public.inventory_shipment_address_access_events enable row level security;
alter table public.inventory_shipment_address_access_events force row level security;
revoke all on table public.inventory_shipment_address_access_events
from public, anon, authenticated, service_role;

create or replace function app_private.guard_shipment_address_access_event_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = '배송정보 열람 감사 기록은 변경할 수 없습니다.';
end;
$$;
revoke all on function app_private.guard_shipment_address_access_event_immutable()
from public, anon, authenticated, service_role;
create trigger inventory_shipment_address_access_events_immutable
before update or delete on public.inventory_shipment_address_access_events
for each row execute function app_private.guard_shipment_address_access_event_immutable();

create or replace function public.reveal_inventory_shipment_address(
  p_shipment_id uuid,
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
  v_reason text := btrim(coalesce(p_reason, ''));
  v_shipment public.inventory_shipments%rowtype;
  v_event public.inventory_shipment_address_access_events%rowtype;
  v_replay boolean := false;
begin
  if v_actor is null
    or p_idempotency_key is null
    or char_length(v_reason) not between 3 and 500
  then
    raise exception using errcode = '22023', message = '배송정보 열람 사유를 입력해 주세요.';
  end if;

  select * into v_event
  from public.inventory_shipment_address_access_events
  where actor_user_id = v_actor
    and idempotency_key = p_idempotency_key;
  if found then
    if v_event.shipment_id <> p_shipment_id or v_event.reason <> v_reason then
      raise exception using errcode = '23505', message = '동일한 요청 키를 재사용할 수 없습니다.';
    end if;
    v_replay := true;
  end if;

  select * into v_shipment
  from public.inventory_shipments
  where id = p_shipment_id;
  if not found then
    raise exception using errcode = 'P0002', message = '배송 신청을 찾지 못했습니다.';
  end if;
  if v_shipment.status = 'cancelled' or v_shipment.delivery_completed_at is not null then
    raise exception using errcode = '55000', message = '완료되거나 취소된 배송정보는 열람할 수 없습니다.';
  end if;
  if not app_private.can_access_inventory_shipment(
    v_shipment.id, 'create_shipments', v_actor
  ) then
    raise exception using errcode = '42501', message = '배송정보를 열람할 권한이 없습니다.';
  end if;

  if not v_replay then
    insert into public.inventory_shipment_address_access_events(
      shipment_id, actor_user_id, idempotency_key, reason
    ) values (
      v_shipment.id, v_actor, p_idempotency_key, v_reason
    )
    on conflict (actor_user_id, idempotency_key) do nothing
    returning * into v_event;
    if not found then
      select * into v_event
      from public.inventory_shipment_address_access_events
      where actor_user_id = v_actor
        and idempotency_key = p_idempotency_key;
      if v_event.shipment_id <> p_shipment_id or v_event.reason <> v_reason then
        raise exception using errcode = '23505', message = '동일한 요청 키를 재사용할 수 없습니다.';
      end if;
      v_replay := true;
    end if;
  end if;

  return jsonb_build_object(
    'shipmentId', v_shipment.id,
    'accessEventId', v_event.id,
    'address', v_shipment.address_snapshot,
    'expiresAt', clock_timestamp() + interval '5 minutes',
    'idempotentReplay', v_replay
  );
end;
$$;

revoke all on function public.reveal_inventory_shipment_address(uuid, text, uuid)
from public, anon, service_role;
grant execute on function public.reveal_inventory_shipment_address(uuid, text, uuid)
to authenticated;

comment on table public.inventory_shipment_address_access_events is
  'Append-only audit of short-lived, reason-required shipment address reveals.';
comment on function public.reveal_inventory_shipment_address(uuid, text, uuid) is
  'Returns an authorized shipment address for five minutes and writes one idempotent audit event.';

commit;
