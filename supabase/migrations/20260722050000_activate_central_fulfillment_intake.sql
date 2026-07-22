begin;

set local lock_timeout = '5s';

-- Activate only the item-intake workflow. Final packing and shipment remain a
-- separate forward migration so the legacy tracking path cannot accidentally
-- become proof of central receipt.
lock table
  public.commerce_orders,
  public.commerce_order_items,
  public.fulfillment_centers,
  public.store_fulfillment_works,
  public.order_item_fulfillments,
  public.fulfillment_events
in share row exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.commerce_order_items as items
    left join public.order_item_fulfillments as fulfillment
      on fulfillment.order_item_id = items.id
    where fulfillment.order_item_id is null
  ) then
    raise exception using
      errcode = '23514',
      message = '기존 주문 상품의 중앙 출고 projection이 완전하지 않습니다.';
  end if;
end;
$$;

alter table public.fulfillment_centers
  add column version bigint not null default 0
    check (version >= 0);

alter table public.store_fulfillment_works
  drop constraint store_fulfillment_works_status_check;
alter table public.store_fulfillment_works
  add constraint store_fulfillment_works_status_check
  check (status in (
    'waiting_payment',
    'reconciliation_required',
    'preparing',
    'ready_for_transfer',
    'in_transit_to_center',
    'partially_received',
    'center_received',
    'issue',
    'cancelled',
    'legacy_terminal'
  ));

alter table public.fulfillment_events
  drop constraint fulfillment_events_event_type_check;
alter table public.fulfillment_events
  add constraint fulfillment_events_event_type_check
  check (event_type in (
    'initialized',
    'payment_confirmed',
    'payment_reversed',
    'legacy_imported',
    'legacy_reconciled',
    'preparation_started',
    'ready_for_transfer',
    'handed_over',
    'received_at_center',
    'stored_at_center',
    'issue_reported',
    'issue_resolved',
    'cancelled'
  ));

create table public.fulfillment_command_receipts (
  actor_user_id uuid not null
    references public.profiles (id) on delete restrict,
  idempotency_key uuid not null,
  command_name text not null
    check (command_name in (
      'configure_center',
      'mark_ready',
      'hand_over',
      'receive',
      'store',
      'report_issue',
      'resolve_issue'
    )),
  target_id uuid not null,
  request_fingerprint text not null
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  result jsonb not null
    check (
      jsonb_typeof(result) = 'object'
      and octet_length(result::text) <= 8192
    ),
  created_at timestamptz not null default now(),
  primary key (actor_user_id, idempotency_key)
);

create index fulfillment_command_receipts_target_idx
  on public.fulfillment_command_receipts (
    command_name,
    target_id,
    created_at desc
  );

create table public.fulfillment_center_events (
  id uuid primary key default gen_random_uuid(),
  fulfillment_center_id uuid not null
    references public.fulfillment_centers (id) on delete restrict,
  event_type text not null check (event_type = 'configured'),
  actor_user_id uuid not null
    references public.profiles (id) on delete restrict,
  actor_role_snapshot text not null
    check (char_length(btrim(actor_role_snapshot)) between 1 and 80),
  idempotency_key uuid not null,
  from_snapshot jsonb not null
    check (
      jsonb_typeof(from_snapshot) = 'object'
      and octet_length(from_snapshot::text) <= 8192
    ),
  to_snapshot jsonb not null
    check (
      jsonb_typeof(to_snapshot) = 'object'
      and octet_length(to_snapshot::text) <= 8192
    ),
  occurred_at timestamptz not null default now(),
  unique (actor_user_id, idempotency_key)
);

create index fulfillment_center_events_history_idx
  on public.fulfillment_center_events (
    fulfillment_center_id,
    occurred_at desc,
    id
  );

create or replace function app_private.reject_fulfillment_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = '물류 명령과 센터 설정 이력은 수정하거나 삭제할 수 없습니다.';
end;
$$;

revoke all on function app_private.reject_fulfillment_audit_mutation()
from public, anon, authenticated, service_role;

create trigger fulfillment_command_receipts_append_only
before update or delete or truncate
on public.fulfillment_command_receipts
for each statement
execute function app_private.reject_fulfillment_audit_mutation();

create trigger fulfillment_center_events_append_only
before update or delete or truncate
on public.fulfillment_center_events
for each statement
execute function app_private.reject_fulfillment_audit_mutation();

create or replace function app_private.fulfillment_command_fingerprint(
  p_payload jsonb
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select encode(extensions.digest(p_payload::text, 'sha256'), 'hex');
$$;

revoke all on function app_private.fulfillment_command_fingerprint(jsonb)
from public, anon, authenticated, service_role;

create or replace function app_private.fulfillment_work_status(
  p_work_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with item_state as (
    select
      count(*) filter (
        where fulfillment.current_stage <> 'cancelled'
      ) as active_count,
      bool_or(
        fulfillment.current_stage = 'reconciliation_required'
      ) filter (
        where fulfillment.current_stage <> 'cancelled'
      ) as has_reconciliation,
      bool_or(fulfillment.is_blocked) filter (
        where fulfillment.current_stage <> 'cancelled'
      ) as has_block,
      bool_and(
        fulfillment.current_stage in ('center_received', 'center_stored')
      ) filter (
        where fulfillment.current_stage <> 'cancelled'
      ) as all_center,
      bool_or(
        fulfillment.current_stage in ('center_received', 'center_stored')
      ) filter (
        where fulfillment.current_stage <> 'cancelled'
      ) as any_center,
      bool_and(
        fulfillment.current_stage = 'in_transit_to_center'
      ) filter (
        where fulfillment.current_stage <> 'cancelled'
      ) as all_transit,
      bool_and(
        fulfillment.current_stage = 'ready_for_transfer'
      ) filter (
        where fulfillment.current_stage <> 'cancelled'
      ) as all_ready,
      bool_and(
        fulfillment.current_stage = 'waiting_payment'
      ) filter (
        where fulfillment.current_stage <> 'cancelled'
      ) as all_waiting
    from public.order_item_fulfillments as fulfillment
    where fulfillment.work_id = p_work_id
  )
  select case
    when active_count = 0 then 'cancelled'
    when coalesce(has_reconciliation, false) then 'reconciliation_required'
    when coalesce(has_block, false) then 'issue'
    when coalesce(all_center, false) then 'center_received'
    when coalesce(any_center, false) then 'partially_received'
    when coalesce(all_transit, false) then 'in_transit_to_center'
    when coalesce(all_ready, false) then 'ready_for_transfer'
    when coalesce(all_waiting, false) then 'waiting_payment'
    else 'preparing'
  end
  from item_state;
$$;

revoke all on function app_private.fulfillment_work_status(uuid)
from public, anon, authenticated, service_role;

create or replace function app_private.refresh_fulfillment_work_status(
  p_work_id uuid,
  p_actor_user_id uuid,
  p_now timestamptz
)
returns public.store_fulfillment_works
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_work public.store_fulfillment_works%rowtype;
begin
  update public.store_fulfillment_works as works
  set
    status = app_private.fulfillment_work_status(works.id),
    version = works.version + 1,
    updated_by = p_actor_user_id,
    updated_at = p_now
  where works.id = p_work_id
  returning works.* into v_work;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = '매장 물류 작업을 찾을 수 없습니다.';
  end if;
  return v_work;
end;
$$;

revoke all on function app_private.refresh_fulfillment_work_status(
  uuid, uuid, timestamptz
)
from public, anon, authenticated, service_role;

create or replace function app_private.initialize_commerce_fulfillment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := transaction_timestamp();
begin
  if exists (
    select 1
    from new_order_items as new_items
    join public.stores as stores
      on stores.id = new_items.store_id
    left join public.fulfillment_centers as centers
      on centers.business_id = stores.business_id
      and centers.is_default
    where centers.id is null
  ) then
    raise exception using
      errcode = '23514',
      message = '주문 상품 사업체의 기본 중앙 출고지를 찾을 수 없습니다.';
  end if;

  insert into public.store_fulfillment_works (
    business_id,
    order_id,
    store_id,
    fulfillment_center_id,
    status,
    version,
    created_at,
    updated_at
  )
  select
    stores.business_id,
    new_items.order_id,
    new_items.store_id,
    centers.id,
    case
      when count(*) filter (
        where new_items.payment_status <> 'cancelled'
      ) = 0 then 'cancelled'
      when bool_and(
        new_items.payment_status = 'awaiting_payment'
      ) filter (
        where new_items.payment_status <> 'cancelled'
      ) then 'waiting_payment'
      else 'preparing'
    end,
    0,
    v_now,
    v_now
  from new_order_items as new_items
  join public.stores as stores
    on stores.id = new_items.store_id
  join public.fulfillment_centers as centers
    on centers.business_id = stores.business_id
    and centers.is_default
  group by
    stores.business_id,
    new_items.order_id,
    new_items.store_id,
    centers.id
  on conflict (order_id, store_id) do nothing;

  if exists (
    select 1
    from new_order_items as new_items
    join public.stores as stores
      on stores.id = new_items.store_id
    join public.fulfillment_centers as centers
      on centers.business_id = stores.business_id
      and centers.is_default
    join public.store_fulfillment_works as works
      on works.order_id = new_items.order_id
      and works.store_id = new_items.store_id
    where works.business_id is distinct from stores.business_id
      or works.fulfillment_center_id is distinct from centers.id
  ) then
    raise exception using
      errcode = '23514',
      message = '주문 상품과 기존 매장 물류 작업의 사업체 또는 센터가 일치하지 않습니다.';
  end if;

  with inserted as (
    insert into public.order_item_fulfillments (
      order_item_id,
      business_id,
      order_id,
      store_id,
      work_id,
      fulfillment_center_id,
      current_stage,
      location_kind,
      is_blocked,
      version,
      last_event_at,
      created_at,
      updated_at
    )
    select
      new_items.id,
      works.business_id,
      new_items.order_id,
      new_items.store_id,
      works.id,
      works.fulfillment_center_id,
      case new_items.payment_status
        when 'paid' then 'preparing'
        when 'cancelled' then 'cancelled'
        else 'waiting_payment'
      end,
      case
        when new_items.payment_status = 'cancelled' then 'unknown'
        else 'store'
      end,
      false,
      0,
      v_now,
      v_now,
      v_now
    from new_order_items as new_items
    join public.store_fulfillment_works as works
      on works.order_id = new_items.order_id
      and works.store_id = new_items.store_id
    on conflict (order_item_id) do nothing
    returning *
  )
  insert into public.fulfillment_events (
    order_item_id,
    sequence_no,
    event_type,
    from_stage,
    to_stage,
    from_location_kind,
    to_location_kind,
    from_location_code,
    to_location_code,
    from_blocked,
    to_blocked,
    actor_kind,
    actor_user_id,
    actor_role_snapshot,
    idempotency_key,
    reason_code,
    metadata,
    occurred_at,
    recorded_at
  )
  select
    inserted.order_item_id,
    1,
    'initialized',
    null,
    inserted.current_stage,
    null,
    inserted.location_kind,
    null,
    inserted.storage_location_code,
    null,
    false,
    'system',
    null,
    'checkout',
    gen_random_uuid(),
    'commerce_order_item_inserted',
    jsonb_build_object(
      'source', 'commerce_order_items_after_insert',
      'initial_payment_status', new_items.payment_status
    ),
    v_now,
    v_now
  from inserted
  join new_order_items as new_items
    on new_items.id = inserted.order_item_id;

  -- A commerce writer may append another item to an existing order/store work.
  -- Recompute only when the aggregate actually changed so a freshly-created
  -- work keeps version 0 while an existing projection gets a visible CAS bump.
  update public.store_fulfillment_works as works
  set
    status = app_private.fulfillment_work_status(works.id),
    version = works.version + 1,
    updated_at = v_now
  where works.id in (
    select distinct item_fulfillment.work_id
    from new_order_items as new_items
    join public.order_item_fulfillments as item_fulfillment
      on item_fulfillment.order_item_id = new_items.id
  )
    and works.status is distinct from app_private.fulfillment_work_status(works.id);

  return null;
end;
$$;

revoke all on function app_private.initialize_commerce_fulfillment()
from public, anon, authenticated, service_role;

create trigger commerce_order_items_initialize_fulfillment
after insert on public.commerce_order_items
referencing new table as new_order_items
for each statement
execute function app_private.initialize_commerce_fulfillment();

create or replace function app_private.sync_commerce_payment_fulfillment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text := coalesce(
    public.access_role_for_user(auth.uid()),
    'system_payment'
  );
  v_now timestamptz := clock_timestamp();
  v_work_id uuid;
begin
  if exists (
    select 1
    from old_order_items as old_items
    join new_order_items as new_items
      on new_items.id = old_items.id
    where old_items.payment_status is distinct from new_items.payment_status
      and not (
        (
          old_items.payment_status = 'awaiting_payment'
          and new_items.payment_status = 'paid'
        )
        or (
          old_items.payment_status = 'paid'
          and new_items.payment_status = 'awaiting_payment'
        )
        or (
          old_items.payment_status in ('awaiting_payment', 'paid')
          and new_items.payment_status = 'cancelled'
        )
      )
  ) then
    raise exception using
      errcode = '55000',
      message = '허용되지 않은 주문 상품 결제 상태 전이입니다.';
  end if;

  if exists (
    select 1
    from old_order_items as old_items
    join new_order_items as new_items
      on new_items.id = old_items.id
    left join public.order_item_fulfillments as fulfillment
      on fulfillment.order_item_id = new_items.id
    where old_items.payment_status is distinct from new_items.payment_status
      and (
        fulfillment.order_item_id is null
        or (
          old_items.payment_status = 'awaiting_payment'
          and new_items.payment_status = 'paid'
          and (
            fulfillment.current_stage <> 'waiting_payment'
            or fulfillment.location_kind <> 'store'
            or fulfillment.is_blocked
          )
        )
        or (
          old_items.payment_status = 'paid'
          and new_items.payment_status = 'awaiting_payment'
          and (
            fulfillment.current_stage <> 'preparing'
            or fulfillment.location_kind <> 'store'
            or fulfillment.is_blocked
          )
        )
        or (
          new_items.payment_status = 'cancelled'
          and (
            fulfillment.current_stage not in ('waiting_payment', 'preparing')
            or fulfillment.location_kind <> 'store'
            or fulfillment.is_blocked
          )
        )
      )
  ) then
    raise exception using
      errcode = '55000',
      message = '물류 작업이 시작된 주문 상품의 결제 상태는 되돌리거나 취소할 수 없습니다.';
  end if;

  for v_work_id in
    with changed as (
      select distinct fulfillment.work_id
      from old_order_items as old_items
      join new_order_items as new_items
        on new_items.id = old_items.id
      join public.order_item_fulfillments as fulfillment
        on fulfillment.order_item_id = new_items.id
      where old_items.payment_status is distinct from new_items.payment_status
    )
    select changed.work_id
    from changed
    order by changed.work_id
  loop
    perform 1
    from public.store_fulfillment_works as works
    where works.id = v_work_id
    for update;
  end loop;

  -- Payment writers already hold commerce item rows. Lock the fulfillment
  -- projection after its parent work and validate again so a concurrent store
  -- hand-over that committed while this trigger waited cannot be overwritten.
  perform 1
  from public.order_item_fulfillments as fulfillment
  join old_order_items as old_items
    on old_items.id = fulfillment.order_item_id
  join new_order_items as new_items
    on new_items.id = old_items.id
  where old_items.payment_status is distinct from new_items.payment_status
  order by fulfillment.order_item_id
  for update of fulfillment;

  if exists (
    select 1
    from old_order_items as old_items
    join new_order_items as new_items
      on new_items.id = old_items.id
    left join public.order_item_fulfillments as fulfillment
      on fulfillment.order_item_id = new_items.id
    where old_items.payment_status is distinct from new_items.payment_status
      and (
        fulfillment.order_item_id is null
        or (
          old_items.payment_status = 'awaiting_payment'
          and new_items.payment_status = 'paid'
          and (
            fulfillment.current_stage <> 'waiting_payment'
            or fulfillment.location_kind <> 'store'
            or fulfillment.is_blocked
          )
        )
        or (
          old_items.payment_status = 'paid'
          and new_items.payment_status = 'awaiting_payment'
          and (
            fulfillment.current_stage <> 'preparing'
            or fulfillment.location_kind <> 'store'
            or fulfillment.is_blocked
          )
        )
        or (
          new_items.payment_status = 'cancelled'
          and (
            fulfillment.current_stage not in ('waiting_payment', 'preparing')
            or fulfillment.location_kind <> 'store'
            or fulfillment.is_blocked
          )
        )
      )
  ) then
    raise exception using
      errcode = '55000',
      message = '동시에 변경된 물류 작업 때문에 결제 상태를 변경할 수 없습니다.';
  end if;

  with changed as (
    select
      fulfillment.order_item_id,
      fulfillment.current_stage as from_stage,
      fulfillment.location_kind as from_location_kind,
      fulfillment.storage_location_code as from_location_code,
      fulfillment.is_blocked as from_blocked,
      fulfillment.version as from_version,
      old_items.payment_status as old_payment_status,
      new_items.payment_status as new_payment_status,
      case
        when new_items.payment_status = 'paid' then 'preparing'
        when new_items.payment_status = 'cancelled' then 'cancelled'
        else 'waiting_payment'
      end as to_stage,
      case
        when new_items.payment_status = 'cancelled' then 'unknown'
        else 'store'
      end as to_location_kind,
      case
        when new_items.payment_status = 'paid' then 'payment_confirmed'
        when new_items.payment_status = 'cancelled' then 'cancelled'
        else 'payment_reversed'
      end as event_type
    from old_order_items as old_items
    join new_order_items as new_items
      on new_items.id = old_items.id
    join public.order_item_fulfillments as fulfillment
      on fulfillment.order_item_id = new_items.id
    where old_items.payment_status is distinct from new_items.payment_status
  ), updated as (
    update public.order_item_fulfillments as fulfillment
    set
      current_stage = changed.to_stage,
      location_kind = changed.to_location_kind,
      storage_location_code = null,
      is_blocked = false,
      block_reason = null,
      version = fulfillment.version + 1,
      last_event_at = v_now,
      updated_at = v_now
    from changed
    where fulfillment.order_item_id = changed.order_item_id
    returning fulfillment.order_item_id
  )
  insert into public.fulfillment_events (
    order_item_id,
    sequence_no,
    event_type,
    from_stage,
    to_stage,
    from_location_kind,
    to_location_kind,
    from_location_code,
    to_location_code,
    from_blocked,
    to_blocked,
    actor_kind,
    actor_user_id,
    actor_role_snapshot,
    idempotency_key,
    reason_code,
    metadata,
    occurred_at,
    recorded_at
  )
  select
    changed.order_item_id,
    coalesce((
      select max(events.sequence_no) + 1
      from public.fulfillment_events as events
      where events.order_item_id = changed.order_item_id
    ), 1),
    changed.event_type,
    changed.from_stage,
    changed.to_stage,
    changed.from_location_kind,
    changed.to_location_kind,
    changed.from_location_code,
    null,
    changed.from_blocked,
    false,
    case when v_actor is null then 'system' else 'user' end,
    v_actor,
    v_actor_role,
    gen_random_uuid(),
    changed.event_type,
    jsonb_build_object(
      'old_payment_status', changed.old_payment_status,
      'new_payment_status', changed.new_payment_status,
      'source', 'commerce_order_items_payment_status'
    ),
    v_now,
    v_now
  from changed
  join updated using (order_item_id);

  for v_work_id in
    with changed as (
      select distinct fulfillment.work_id
      from old_order_items as old_items
      join new_order_items as new_items
        on new_items.id = old_items.id
      join public.order_item_fulfillments as fulfillment
        on fulfillment.order_item_id = new_items.id
      where old_items.payment_status is distinct from new_items.payment_status
    )
    select changed.work_id
    from changed
    order by changed.work_id
  loop
    perform app_private.refresh_fulfillment_work_status(
      v_work_id,
      v_actor,
      v_now
    );
  end loop;

  return null;
end;
$$;

revoke all on function app_private.sync_commerce_payment_fulfillment()
from public, anon, authenticated, service_role;

create trigger commerce_order_items_sync_payment_fulfillment
after update on public.commerce_order_items
referencing old table as old_order_items new table as new_order_items
for each statement
execute function app_private.sync_commerce_payment_fulfillment();

create or replace function public.configure_fulfillment_center(
  p_center_id uuid,
  p_expected_version bigint,
  p_postal_code text,
  p_address_line1 text,
  p_address_line2 text,
  p_contact_name text,
  p_contact_phone text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text := public.access_role_for_user(auth.uid());
  v_center public.fulfillment_centers%rowtype;
  v_receipt public.fulfillment_command_receipts%rowtype;
  v_fingerprint text;
  v_result jsonb;
  v_from_snapshot jsonb;
  v_to_snapshot jsonb;
  v_now timestamptz := clock_timestamp();
  v_postal_code text := nullif(btrim(p_postal_code), '');
  v_address_line1 text := nullif(btrim(p_address_line1), '');
  v_address_line2 text := nullif(btrim(p_address_line2), '');
  v_contact_name text := nullif(btrim(p_contact_name), '');
  v_contact_phone text := nullif(btrim(p_contact_phone), '');
begin
  if v_actor is null or not public.is_owner() or v_actor_role <> 'owner' then
    raise exception using
      errcode = '42501',
      message = '중앙 출고지 설정은 시스템 관리자만 변경할 수 있습니다.';
  end if;
  if p_center_id is null
    or p_expected_version is null
    or p_expected_version < 0
    or p_idempotency_key is null
  then
    raise exception using
      errcode = '22023',
      message = '센터 설정 요청이 올바르지 않습니다.';
  end if;

  v_fingerprint := app_private.fulfillment_command_fingerprint(
    jsonb_build_object(
      'center_id', p_center_id,
      'expected_version', p_expected_version,
      'postal_code', v_postal_code,
      'address_line1', v_address_line1,
      'address_line2', v_address_line2,
      'contact_name', v_contact_name,
      'contact_phone', v_contact_phone
    )
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select receipts.* into v_receipt
  from public.fulfillment_command_receipts as receipts
  where receipts.actor_user_id = v_actor
    and receipts.idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.command_name <> 'configure_center'
      or v_receipt.target_id <> p_center_id
      or v_receipt.request_fingerprint <> v_fingerprint
    then
      raise exception using
        errcode = '22000',
        message = '같은 물류 요청 키에 다른 센터 설정을 사용할 수 없습니다.';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay', true);
  end if;

  select centers.* into v_center
  from public.fulfillment_centers as centers
  where centers.id = p_center_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = '중앙 출고지를 찾을 수 없습니다.';
  end if;
  if v_center.version <> p_expected_version then
    raise exception using
      errcode = '55000',
      message = '센터 설정이 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
  end if;

  v_from_snapshot := jsonb_build_object(
    'status', v_center.status,
    'postal_code', v_center.postal_code,
    'address_line1', v_center.address_line1,
    'address_line2', v_center.address_line2,
    'contact_name', v_center.contact_name,
    'contact_phone', v_center.contact_phone,
    'version', v_center.version
  );

  update public.fulfillment_centers as centers
  set
    status = 'active',
    postal_code = v_postal_code,
    address_line1 = v_address_line1,
    address_line2 = v_address_line2,
    contact_name = v_contact_name,
    contact_phone = v_contact_phone,
    updated_by = v_actor,
    updated_at = v_now,
    version = centers.version + 1
  where centers.id = p_center_id
  returning centers.* into v_center;

  v_to_snapshot := jsonb_build_object(
    'status', v_center.status,
    'postal_code', v_center.postal_code,
    'address_line1', v_center.address_line1,
    'address_line2', v_center.address_line2,
    'contact_name', v_center.contact_name,
    'contact_phone', v_center.contact_phone,
    'version', v_center.version
  );

  insert into public.fulfillment_center_events (
    fulfillment_center_id,
    event_type,
    actor_user_id,
    actor_role_snapshot,
    idempotency_key,
    from_snapshot,
    to_snapshot,
    occurred_at
  ) values (
    v_center.id,
    'configured',
    v_actor,
    v_actor_role,
    p_idempotency_key,
    v_from_snapshot,
    v_to_snapshot,
    v_now
  );

  v_result := jsonb_build_object(
    'center_id', v_center.id,
    'status', v_center.status,
    'postal_code', v_center.postal_code,
    'address_line1', v_center.address_line1,
    'address_line2', v_center.address_line2,
    'contact_name', v_center.contact_name,
    'contact_phone', v_center.contact_phone,
    'version', v_center.version,
    'idempotent_replay', false
  );

  insert into public.fulfillment_command_receipts (
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
    'configure_center',
    v_center.id,
    v_fingerprint,
    v_result,
    v_now
  );
  return v_result;
end;
$$;

revoke all on function public.configure_fulfillment_center(
  uuid, bigint, text, text, text, text, text, uuid
)
from public, anon, authenticated, service_role;
grant execute on function public.configure_fulfillment_center(
  uuid, bigint, text, text, text, text, text, uuid
)
to authenticated;

create or replace function public.advance_store_fulfillment_work(
  p_work_id uuid,
  p_expected_version bigint,
  p_action text,
  p_idempotency_key uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text := public.access_role_for_user(auth.uid());
  v_work public.store_fulfillment_works%rowtype;
  v_order public.commerce_orders%rowtype;
  v_center public.fulfillment_centers%rowtype;
  v_receipt public.fulfillment_command_receipts%rowtype;
  v_fingerprint text;
  v_result jsonb;
  v_command text := lower(nullif(btrim(p_action), ''));
  v_note text := nullif(btrim(p_note), '');
  v_from_stage text;
  v_to_stage text;
  v_event_type text;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null
    or p_work_id is null
    or p_expected_version is null
    or p_expected_version < 0
    or p_idempotency_key is null
    or v_command not in ('mark_ready', 'hand_over')
    or (v_note is not null and char_length(v_note) > 1000)
  then
    raise exception using
      errcode = '22023',
      message = '매장 물류 작업 요청이 올바르지 않습니다.';
  end if;

  v_fingerprint := app_private.fulfillment_command_fingerprint(
    jsonb_build_object(
      'work_id', p_work_id,
      'expected_version', p_expected_version,
      'action', v_command,
      'note', v_note
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select receipts.* into v_receipt
  from public.fulfillment_command_receipts as receipts
  where receipts.actor_user_id = v_actor
    and receipts.idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.command_name <> v_command
      or v_receipt.target_id <> p_work_id
      or v_receipt.request_fingerprint <> v_fingerprint
    then
      raise exception using
        errcode = '22000',
        message = '같은 물류 요청 키에 다른 매장 작업을 사용할 수 없습니다.';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay', true);
  end if;

  select works.* into v_work
  from public.store_fulfillment_works as works
  where works.id = p_work_id;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = '매장 물류 작업을 찾을 수 없습니다.';
  end if;

  select orders.* into v_order
  from public.commerce_orders as orders
  where orders.id = v_work.order_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = '통합 주문을 찾을 수 없습니다.';
  end if;

  select works.* into v_work
  from public.store_fulfillment_works as works
  where works.id = p_work_id
  for update;

  if not public.has_store_permission(v_work.store_id, 'prepare_orders') then
    raise exception using
      errcode = '42501',
      message = '이 매장의 상품 준비 권한이 없습니다.';
  end if;
  if v_work.version <> p_expected_version then
    raise exception using
      errcode = '55000',
      message = '매장 물류 작업이 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
  end if;
  if v_order.status <> 'paid' then
    raise exception using
      errcode = '55000',
      message = '통합 입금이 확정된 주문만 준비할 수 있습니다.';
  end if;

  select centers.* into v_center
  from public.fulfillment_centers as centers
  where centers.id = v_work.fulfillment_center_id;
  if not found or v_center.status <> 'active' then
    raise exception using
      errcode = '55000',
      message = '중앙 출고지 실제 주소를 먼저 설정해 주세요.';
  end if;

  if v_command = 'mark_ready' then
    v_from_stage := 'preparing';
    v_to_stage := 'ready_for_transfer';
    v_event_type := 'ready_for_transfer';
    if v_work.status <> 'preparing' then
      raise exception using
        errcode = '55000',
        message = '준비 중인 매장 작업만 인계 준비 완료로 바꿀 수 있습니다.';
    end if;
  else
    v_from_stage := 'ready_for_transfer';
    v_to_stage := 'in_transit_to_center';
    v_event_type := 'handed_over';
    if v_work.status <> 'ready_for_transfer' then
      raise exception using
        errcode = '55000',
        message = '준비 완료된 매장 작업만 중앙 출고지로 인계할 수 있습니다.';
    end if;
  end if;

  perform 1
  from public.order_item_fulfillments as fulfillment
  where fulfillment.work_id = v_work.id
  order by fulfillment.order_item_id
  for update;

  if not exists (
    select 1
    from public.order_item_fulfillments as fulfillment
    where fulfillment.work_id = v_work.id
      and fulfillment.current_stage <> 'cancelled'
  ) or exists (
    select 1
    from public.order_item_fulfillments as fulfillment
    join public.commerce_order_items as items
      on items.id = fulfillment.order_item_id
    where fulfillment.work_id = v_work.id
      and fulfillment.current_stage <> 'cancelled'
      and (
        fulfillment.current_stage <> v_from_stage
        or fulfillment.location_kind <> 'store'
        or fulfillment.is_blocked
        or items.payment_status <> 'paid'
      )
  ) then
    raise exception using
      errcode = '55000',
      message = '매장 상품 상태가 작업 단계와 일치하지 않습니다.';
  end if;

  with current_items as materialized (
    select
      fulfillment.order_item_id,
      fulfillment.current_stage,
      fulfillment.location_kind,
      fulfillment.storage_location_code,
      fulfillment.is_blocked
    from public.order_item_fulfillments as fulfillment
    where fulfillment.work_id = v_work.id
      and fulfillment.current_stage <> 'cancelled'
    order by fulfillment.order_item_id
  ), updated as (
    update public.order_item_fulfillments as fulfillment
    set
      current_stage = v_to_stage,
      location_kind = case
        when v_to_stage = 'in_transit_to_center' then 'transit'
        else 'store'
      end,
      storage_location_code = null,
      version = fulfillment.version + 1,
      last_event_at = v_now,
      updated_at = v_now
    from current_items
    where fulfillment.order_item_id = current_items.order_item_id
    returning fulfillment.order_item_id
  )
  insert into public.fulfillment_events (
    order_item_id,
    sequence_no,
    event_type,
    from_stage,
    to_stage,
    from_location_kind,
    to_location_kind,
    from_location_code,
    to_location_code,
    from_blocked,
    to_blocked,
    actor_kind,
    actor_user_id,
    actor_role_snapshot,
    idempotency_key,
    reason_code,
    note,
    metadata,
    occurred_at,
    recorded_at
  )
  select
    current_items.order_item_id,
    coalesce((
      select max(events.sequence_no) + 1
      from public.fulfillment_events as events
      where events.order_item_id = current_items.order_item_id
    ), 1),
    v_event_type,
    current_items.current_stage,
    v_to_stage,
    current_items.location_kind,
    case when v_to_stage = 'in_transit_to_center' then 'transit' else 'store' end,
    current_items.storage_location_code,
    null,
    current_items.is_blocked,
    false,
    'user',
    v_actor,
    v_actor_role,
    p_idempotency_key,
    v_command,
    v_note,
    jsonb_build_object('work_id', v_work.id, 'action', v_command),
    v_now,
    v_now
  from current_items
  join updated using (order_item_id);

  update public.store_fulfillment_works as works
  set
    status = v_to_stage,
    version = works.version + 1,
    updated_by = v_actor,
    updated_at = v_now
  where works.id = v_work.id
  returning works.* into v_work;

  v_result := jsonb_build_object(
    'work_id', v_work.id,
    'order_id', v_work.order_id,
    'store_id', v_work.store_id,
    'status', v_work.status,
    'version', v_work.version,
    'idempotent_replay', false
  );
  insert into public.fulfillment_command_receipts (
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
    v_command,
    v_work.id,
    v_fingerprint,
    v_result,
    v_now
  );
  return v_result;
end;
$$;

revoke all on function public.advance_store_fulfillment_work(
  uuid, bigint, text, uuid, text
)
from public, anon, authenticated, service_role;
grant execute on function public.advance_store_fulfillment_work(
  uuid, bigint, text, uuid, text
)
to authenticated;

create or replace function public.record_center_item_action(
  p_order_item_id uuid,
  p_expected_version bigint,
  p_action text,
  p_idempotency_key uuid,
  p_storage_location_code text default null,
  p_reason_code text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text := public.access_role_for_user(auth.uid());
  v_item public.order_item_fulfillments%rowtype;
  v_work public.store_fulfillment_works%rowtype;
  v_order public.commerce_orders%rowtype;
  v_order_item public.commerce_order_items%rowtype;
  v_center public.fulfillment_centers%rowtype;
  v_receipt public.fulfillment_command_receipts%rowtype;
  v_fingerprint text;
  v_result jsonb;
  v_command text := lower(nullif(btrim(p_action), ''));
  v_location_code text := nullif(btrim(p_storage_location_code), '');
  v_reason_code text := lower(nullif(btrim(p_reason_code), ''));
  v_note text := nullif(btrim(p_note), '');
  v_from_stage text;
  v_from_location_kind text;
  v_from_location_code text;
  v_from_blocked boolean;
  v_to_stage text;
  v_to_location_kind text;
  v_to_location_code text;
  v_to_blocked boolean;
  v_event_type text;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null
    or p_order_item_id is null
    or p_expected_version is null
    or p_expected_version < 0
    or p_idempotency_key is null
    or v_command not in ('receive', 'store', 'report_issue', 'resolve_issue')
    or (v_location_code is not null and char_length(v_location_code) > 120)
    or (v_reason_code is not null and char_length(v_reason_code) > 80)
    or (v_note is not null and char_length(v_note) > 1000)
  then
    raise exception using
      errcode = '22023',
      message = '중앙 입고 작업 요청이 올바르지 않습니다.';
  end if;

  if (v_command = 'receive' and (
      v_location_code is not null or v_reason_code is not null
    ))
    or (v_command = 'store' and (
      v_location_code is null or v_reason_code is not null
    ))
    or (v_command in ('report_issue', 'resolve_issue') and (
      v_location_code is not null or v_reason_code is null or v_note is null
    ))
  then
    raise exception using
      errcode = '22023',
      message = '중앙 입고 작업 단계에 필요한 정보가 올바르지 않습니다.';
  end if;

  v_fingerprint := app_private.fulfillment_command_fingerprint(
    jsonb_build_object(
      'order_item_id', p_order_item_id,
      'expected_version', p_expected_version,
      'action', v_command,
      'storage_location_code', v_location_code,
      'reason_code', v_reason_code,
      'note', v_note
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select receipts.* into v_receipt
  from public.fulfillment_command_receipts as receipts
  where receipts.actor_user_id = v_actor
    and receipts.idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.command_name <> v_command
      or v_receipt.target_id <> p_order_item_id
      or v_receipt.request_fingerprint <> v_fingerprint
    then
      raise exception using
        errcode = '22000',
        message = '같은 물류 요청 키에 다른 중앙 입고 작업을 사용할 수 없습니다.';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay', true);
  end if;

  select fulfillment.* into v_item
  from public.order_item_fulfillments as fulfillment
  where fulfillment.order_item_id = p_order_item_id;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = '주문 상품 물류 상태를 찾을 수 없습니다.';
  end if;

  select orders.* into v_order
  from public.commerce_orders as orders
  where orders.id = v_item.order_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = '통합 주문을 찾을 수 없습니다.';
  end if;

  select works.* into v_work
  from public.store_fulfillment_works as works
  where works.id = v_item.work_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = '매장 물류 작업을 찾을 수 없습니다.';
  end if;

  select fulfillment.* into v_item
  from public.order_item_fulfillments as fulfillment
  where fulfillment.order_item_id = p_order_item_id
  for update;
  if not found
    or v_item.work_id <> v_work.id
    or v_item.order_id <> v_order.id
  then
    raise exception using
      errcode = '23514',
      message = '주문 상품 물류 연결이 일치하지 않습니다.';
  end if;

  if not public.has_business_permission(
    v_work.business_id,
    'receive_at_center'
  ) then
    raise exception using
      errcode = '42501',
      message = '중앙 입고 처리 권한이 없습니다.';
  end if;
  if v_item.version <> p_expected_version then
    raise exception using
      errcode = '55000',
      message = '주문 상품 물류 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
  end if;
  if v_order.status <> 'paid' then
    raise exception using
      errcode = '55000',
      message = '통합 입금이 확정된 주문만 중앙에서 처리할 수 있습니다.';
  end if;

  select items.* into v_order_item
  from public.commerce_order_items as items
  where items.id = v_item.order_item_id;
  if not found or v_order_item.payment_status <> 'paid' then
    raise exception using
      errcode = '55000',
      message = '입금이 확정된 주문 상품만 중앙에서 처리할 수 있습니다.';
  end if;

  select centers.* into v_center
  from public.fulfillment_centers as centers
  where centers.id = v_item.fulfillment_center_id;
  if not found or v_center.status <> 'active' then
    raise exception using
      errcode = '55000',
      message = '활성 중앙 출고지를 찾을 수 없습니다.';
  end if;

  v_from_stage := v_item.current_stage;
  v_from_location_kind := v_item.location_kind;
  v_from_location_code := v_item.storage_location_code;
  v_from_blocked := v_item.is_blocked;

  if v_command = 'receive' then
    if v_item.current_stage <> 'in_transit_to_center'
      or v_item.location_kind <> 'transit'
      or v_item.is_blocked
    then
      raise exception using
        errcode = '55000',
        message = '중앙으로 인계 중인 정상 상품만 입고할 수 있습니다.';
    end if;
    v_to_stage := 'center_received';
    v_to_location_kind := 'center';
    v_to_location_code := null;
    v_to_blocked := false;
    v_event_type := 'received_at_center';
  elsif v_command = 'store' then
    if v_item.current_stage <> 'center_received'
      or v_item.location_kind <> 'center'
      or v_item.is_blocked
    then
      raise exception using
        errcode = '55000',
        message = '입고 확인된 정상 상품만 보관 위치에 배치할 수 있습니다.';
    end if;
    v_to_stage := 'center_stored';
    v_to_location_kind := 'center';
    v_to_location_code := v_location_code;
    v_to_blocked := false;
    v_event_type := 'stored_at_center';
  elsif v_command = 'report_issue' then
    if v_item.current_stage not in ('center_received', 'center_stored')
      or v_item.location_kind <> 'center'
      or v_item.is_blocked
    then
      raise exception using
        errcode = '55000',
        message = '중앙에 입고된 정상 상품에만 문제를 등록할 수 있습니다.';
    end if;
    v_to_stage := v_item.current_stage;
    v_to_location_kind := v_item.location_kind;
    v_to_location_code := v_item.storage_location_code;
    v_to_blocked := true;
    v_event_type := 'issue_reported';
  else
    if v_item.current_stage not in ('center_received', 'center_stored')
      or v_item.location_kind <> 'center'
      or not v_item.is_blocked
    then
      raise exception using
        errcode = '55000',
        message = '중앙에서 차단된 상품만 문제를 해제할 수 있습니다.';
    end if;
    v_to_stage := v_item.current_stage;
    v_to_location_kind := v_item.location_kind;
    v_to_location_code := v_item.storage_location_code;
    v_to_blocked := false;
    v_event_type := 'issue_resolved';
  end if;

  update public.order_item_fulfillments as fulfillment
  set
    current_stage = v_to_stage,
    location_kind = v_to_location_kind,
    storage_location_code = v_to_location_code,
    is_blocked = v_to_blocked,
    block_reason = case when v_to_blocked then v_note else null end,
    version = fulfillment.version + 1,
    last_event_at = v_now,
    updated_at = v_now
  where fulfillment.order_item_id = v_item.order_item_id
  returning fulfillment.* into v_item;

  insert into public.fulfillment_events (
    order_item_id,
    sequence_no,
    event_type,
    from_stage,
    to_stage,
    from_location_kind,
    to_location_kind,
    from_location_code,
    to_location_code,
    from_blocked,
    to_blocked,
    actor_kind,
    actor_user_id,
    actor_role_snapshot,
    idempotency_key,
    reason_code,
    note,
    metadata,
    occurred_at,
    recorded_at
  ) values (
    v_item.order_item_id,
    coalesce((
      select max(events.sequence_no) + 1
      from public.fulfillment_events as events
      where events.order_item_id = v_item.order_item_id
    ), 1),
    v_event_type,
    v_from_stage,
    v_to_stage,
    v_from_location_kind,
    v_to_location_kind,
    v_from_location_code,
    v_to_location_code,
    v_from_blocked,
    v_to_blocked,
    'user',
    v_actor,
    v_actor_role,
    p_idempotency_key,
    coalesce(v_reason_code, v_command),
    v_note,
    jsonb_build_object(
      'work_id', v_work.id,
      'action', v_command,
      'storage_location_code', v_to_location_code
    ),
    v_now,
    v_now
  );

  v_work := app_private.refresh_fulfillment_work_status(
    v_work.id,
    v_actor,
    v_now
  );

  v_result := jsonb_build_object(
    'order_item_id', v_item.order_item_id,
    'work_id', v_item.work_id,
    'stage', v_item.current_stage,
    'location_kind', v_item.location_kind,
    'storage_location_code', v_item.storage_location_code,
    'is_blocked', v_item.is_blocked,
    'block_reason', v_item.block_reason,
    'version', v_item.version,
    'work_status', v_work.status,
    'work_version', v_work.version,
    'idempotent_replay', false
  );
  insert into public.fulfillment_command_receipts (
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
    v_command,
    v_item.order_item_id,
    v_fingerprint,
    v_result,
    v_now
  );
  return v_result;
end;
$$;

revoke all on function public.record_center_item_action(
  uuid, bigint, text, uuid, text, text, text
)
from public, anon, authenticated, service_role;
grant execute on function public.record_center_item_action(
  uuid, bigint, text, uuid, text, text, text
)
to authenticated;

create or replace function public.get_store_fulfillment_queue(
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  work_id uuid,
  order_id uuid,
  store_id uuid,
  store_name text,
  business_id uuid,
  work_status text,
  work_version bigint,
  order_status text,
  order_created_at timestamptz,
  center_id uuid,
  center_name text,
  center_status text,
  center_postal_code text,
  center_address_line1 text,
  center_address_line2 text,
  center_contact_name text,
  center_contact_phone text,
  active_item_count bigint,
  blocked_item_count bigint,
  items jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or p_limit is null
    or p_limit < 1
    or p_limit > 200
    or p_offset is null
    or p_offset < 0
  then
    raise exception using
      errcode = '22023',
      message = '매장 물류 목록 조회 범위가 올바르지 않습니다.';
  end if;

  return query
  select
    works.id,
    works.order_id,
    works.store_id,
    stores.name,
    works.business_id,
    works.status,
    works.version,
    orders.status,
    orders.created_at,
    centers.id,
    centers.name,
    centers.status,
    centers.postal_code,
    centers.address_line1,
    centers.address_line2,
    centers.contact_name,
    centers.contact_phone,
    item_summary.active_item_count,
    item_summary.blocked_item_count,
    item_summary.items
  from public.store_fulfillment_works as works
  join public.commerce_orders as orders
    on orders.id = works.order_id
  join public.stores as stores
    on stores.id = works.store_id
  join public.fulfillment_centers as centers
    on centers.id = works.fulfillment_center_id
  cross join lateral (
    select
      count(*) filter (
        where fulfillment.current_stage <> 'cancelled'
      ) as active_item_count,
      count(*) filter (
        where fulfillment.current_stage <> 'cancelled'
          and fulfillment.is_blocked
      ) as blocked_item_count,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'orderItemId', fulfillment.order_item_id,
            'productId', order_items.product_id,
            'title', products.title,
            'imageUrl', coalesce(
              (products.thumbnail_urls)[1],
              (products.image_urls)[1]
            ),
            'paymentStatus', order_items.payment_status,
            'stage', fulfillment.current_stage,
            'locationKind', fulfillment.location_kind,
            'storageLocationCode', fulfillment.storage_location_code,
            'isBlocked', fulfillment.is_blocked,
            'blockReason', fulfillment.block_reason,
            'version', fulfillment.version,
            'updatedAt', fulfillment.updated_at
          ) order by order_items.created_at, fulfillment.order_item_id
        ),
        '[]'::jsonb
      ) as items
    from public.order_item_fulfillments as fulfillment
    join public.commerce_order_items as order_items
      on order_items.id = fulfillment.order_item_id
    join public.products as products
      on products.id = order_items.product_id
    where fulfillment.work_id = works.id
  ) as item_summary
  where public.has_store_permission(works.store_id, 'prepare_orders')
    and works.status not in (
      'reconciliation_required',
      'cancelled',
      'legacy_terminal'
    )
  order by works.updated_at, works.id
  limit p_limit
  offset p_offset;
end;
$$;

revoke all on function public.get_store_fulfillment_queue(integer, integer)
from public, anon, authenticated, service_role;
grant execute on function public.get_store_fulfillment_queue(integer, integer)
to authenticated;

create or replace function public.get_center_fulfillment_queue(
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  work_id uuid,
  order_id uuid,
  store_id uuid,
  store_name text,
  business_id uuid,
  work_status text,
  work_version bigint,
  order_status text,
  order_created_at timestamptz,
  center_id uuid,
  center_name text,
  center_status text,
  active_item_count bigint,
  received_item_count bigint,
  stored_item_count bigint,
  blocked_item_count bigint,
  items jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or p_limit is null
    or p_limit < 1
    or p_limit > 200
    or p_offset is null
    or p_offset < 0
  then
    raise exception using
      errcode = '22023',
      message = '중앙 물류 목록 조회 범위가 올바르지 않습니다.';
  end if;

  return query
  select
    works.id,
    works.order_id,
    works.store_id,
    stores.name,
    works.business_id,
    works.status,
    works.version,
    orders.status,
    orders.created_at,
    centers.id,
    centers.name,
    centers.status,
    item_summary.active_item_count,
    item_summary.received_item_count,
    item_summary.stored_item_count,
    item_summary.blocked_item_count,
    item_summary.items
  from public.store_fulfillment_works as works
  join public.commerce_orders as orders
    on orders.id = works.order_id
  join public.stores as stores
    on stores.id = works.store_id
  join public.fulfillment_centers as centers
    on centers.id = works.fulfillment_center_id
  cross join lateral (
    select
      count(*) filter (
        where fulfillment.current_stage <> 'cancelled'
      ) as active_item_count,
      count(*) filter (
        where fulfillment.current_stage = 'center_received'
      ) as received_item_count,
      count(*) filter (
        where fulfillment.current_stage = 'center_stored'
      ) as stored_item_count,
      count(*) filter (
        where fulfillment.current_stage <> 'cancelled'
          and fulfillment.is_blocked
      ) as blocked_item_count,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'orderItemId', fulfillment.order_item_id,
            'productId', order_items.product_id,
            'title', products.title,
            'imageUrl', coalesce(
              (products.thumbnail_urls)[1],
              (products.image_urls)[1]
            ),
            'paymentStatus', order_items.payment_status,
            'stage', fulfillment.current_stage,
            'locationKind', fulfillment.location_kind,
            'storageLocationCode', fulfillment.storage_location_code,
            'isBlocked', fulfillment.is_blocked,
            'blockReason', fulfillment.block_reason,
            'version', fulfillment.version,
            'updatedAt', fulfillment.updated_at
          ) order by order_items.created_at, fulfillment.order_item_id
        ),
        '[]'::jsonb
      ) as items
    from public.order_item_fulfillments as fulfillment
    join public.commerce_order_items as order_items
      on order_items.id = fulfillment.order_item_id
    join public.products as products
      on products.id = order_items.product_id
    where fulfillment.work_id = works.id
  ) as item_summary
  where public.has_business_permission(
      works.business_id,
      'receive_at_center'
    )
    and exists (
      select 1
      from public.order_item_fulfillments as fulfillment
      where fulfillment.work_id = works.id
        and fulfillment.current_stage in (
          'in_transit_to_center',
          'center_received',
          'center_stored'
        )
    )
  order by works.updated_at, works.id
  limit p_limit
  offset p_offset;
end;
$$;

revoke all on function public.get_center_fulfillment_queue(integer, integer)
from public, anon, authenticated, service_role;
grant execute on function public.get_center_fulfillment_queue(integer, integer)
to authenticated;

alter table public.fulfillment_command_receipts enable row level security;
alter table public.fulfillment_command_receipts force row level security;
alter table public.fulfillment_center_events enable row level security;
alter table public.fulfillment_center_events force row level security;

revoke all privileges on table
  public.fulfillment_command_receipts,
  public.fulfillment_center_events
from public, anon, authenticated, service_role;

grant select on table
  public.fulfillment_command_receipts,
  public.fulfillment_center_events
to authenticated;

create policy "Actors and owners read fulfillment command receipts"
on public.fulfillment_command_receipts
for select
to authenticated
using (
  actor_user_id = (select auth.uid())
  or (select public.is_owner())
);

create policy "Authorized staff read fulfillment center events"
on public.fulfillment_center_events
for select
to authenticated
using (
  (select public.is_owner())
  or exists (
    select 1
    from public.fulfillment_centers as centers
    where centers.id = fulfillment_center_id
      and public.has_business_permission(
        centers.business_id,
        'receive_at_center'
      )
  )
);

drop policy if exists "Owners read businesses"
on public.businesses;
drop policy if exists "Owners read fulfillment centers"
on public.fulfillment_centers;
drop policy if exists "Owners read store fulfillment works"
on public.store_fulfillment_works;
drop policy if exists "Owners read order item fulfillments"
on public.order_item_fulfillments;
drop policy if exists "Owners read fulfillment events"
on public.fulfillment_events;

create policy "Authorized staff read businesses"
on public.businesses
for select
to authenticated
using (
  (select public.is_owner())
  or public.has_business_permission(id, 'prepare_orders')
  or public.has_business_permission(id, 'receive_at_center')
  or public.has_business_permission(id, 'create_shipments')
);

create policy "Authorized staff read fulfillment centers"
on public.fulfillment_centers
for select
to authenticated
using (
  (select public.is_owner())
  or public.has_business_permission(business_id, 'prepare_orders')
  or public.has_business_permission(business_id, 'receive_at_center')
  or public.has_business_permission(business_id, 'create_shipments')
);

create policy "Authorized staff read store fulfillment works"
on public.store_fulfillment_works
for select
to authenticated
using (
  (select public.is_owner())
  or public.has_store_permission(store_id, 'prepare_orders')
  or public.has_business_permission(business_id, 'receive_at_center')
  or public.has_business_permission(business_id, 'create_shipments')
);

create policy "Authorized staff read order item fulfillments"
on public.order_item_fulfillments
for select
to authenticated
using (
  (select public.is_owner())
  or public.has_store_permission(store_id, 'prepare_orders')
  or public.has_business_permission(business_id, 'receive_at_center')
  or public.has_business_permission(business_id, 'create_shipments')
);

create policy "Authorized staff read fulfillment events"
on public.fulfillment_events
for select
to authenticated
using (
  (select public.is_owner())
  or exists (
    select 1
    from public.order_item_fulfillments as fulfillment
    where fulfillment.order_item_id = fulfillment_events.order_item_id
      and (
        public.has_store_permission(
          fulfillment.store_id,
          'prepare_orders'
        )
        or public.has_business_permission(
          fulfillment.business_id,
          'receive_at_center'
        )
        or public.has_business_permission(
          fulfillment.business_id,
          'create_shipments'
        )
      )
  )
);

comment on table public.fulfillment_command_receipts is
  'Per-actor idempotency receipts for central fulfillment commands.';
comment on table public.fulfillment_center_events is
  'Append-only audit history for real central fulfillment-center configuration.';
comment on function public.configure_fulfillment_center(
  uuid, bigint, text, text, text, text, text, uuid
) is
  'Owner-only CAS and idempotent activation of a real central fulfillment address.';
comment on function public.advance_store_fulfillment_work(
  uuid, bigint, text, uuid, text
) is
  'Permission-scoped, CAS and idempotent store preparation and center hand-over transition.';
comment on function public.record_center_item_action(
  uuid, bigint, text, uuid, text, text, text
) is
  'Permission-scoped, item-level central receipt, storage and issue workflow.';
comment on function public.get_store_fulfillment_queue(integer, integer) is
  'Store-scoped preparation queue without customer delivery data.';
comment on function public.get_center_fulfillment_queue(integer, integer) is
  'Business-permission-scoped central intake queue without customer delivery data.';

commit;
