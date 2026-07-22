begin;

set local lock_timeout = '5s';

-- Keep the legacy commerce, storage, and shipping facts stable while their
-- fulfillment projections are classified and copied.
lock table
  public.stores,
  public.commerce_orders,
  public.commerce_order_items,
  public.shipping_requests,
  public.shipping_request_items
in share row exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.commerce_order_items as items
    where items.store_id is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'commerce_order_items.store_id가 비어 있어 중앙 출고 기반을 안전하게 생성할 수 없습니다.';
  end if;
end;
$$;

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique
    check (code ~ '^[a-z0-9-]{2,80}$'),
  name text not null
    check (char_length(btrim(name)) between 1 and 120),
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint businesses_timestamp_order_check
    check (updated_at >= created_at)
);

insert into public.businesses (id, code, name, status)
values (
  '99000000-0000-4000-8000-000000000001'::uuid,
  'ninety-nine-vintage',
  'NINETY-NINE VINTAGE',
  'active'
);

alter table public.stores
  add column business_id uuid;

update public.stores
set business_id = '99000000-0000-4000-8000-000000000001'::uuid
where business_id is null;

alter table public.stores
  alter column business_id
    set default '99000000-0000-4000-8000-000000000001'::uuid,
  alter column business_id set not null,
  add constraint stores_business_id_fkey
    foreign key (business_id)
    references public.businesses (id)
    on delete restrict,
  add constraint stores_id_business_id_key
    unique (id, business_id);

-- The order-item snapshot is the fulfillment ownership boundary. Refuse to
-- infer a missing store, and make that boundary available to composite FKs.
alter table public.commerce_order_items
  alter column store_id set not null,
  add constraint commerce_order_items_id_order_id_store_id_key
    unique (id, order_id, store_id);

create table public.fulfillment_centers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  code text not null
    check (code ~ '^[a-z0-9-]{2,80}$'),
  name text not null
    check (char_length(btrim(name)) between 1 and 120),
  status text not null default 'configuration_required'
    check (status in ('configuration_required', 'active', 'inactive')),
  is_default boolean not null default false,
  postal_code text,
  address_line1 text,
  address_line2 text,
  contact_name text,
  contact_phone text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fulfillment_centers_business_id_fkey
    foreign key (business_id)
    references public.businesses (id)
    on delete restrict,
  constraint fulfillment_centers_business_identity_key
    unique (id, business_id),
  constraint fulfillment_centers_business_code_key
    unique (business_id, code),
  constraint fulfillment_centers_timestamp_order_check
    check (updated_at >= created_at),
  constraint fulfillment_centers_default_status_check
    check (not is_default or status <> 'inactive'),
  constraint fulfillment_centers_configuration_required_check
    check (
      status <> 'configuration_required'
      or (
        postal_code is null
        and address_line1 is null
        and address_line2 is null
        and contact_name is null
        and contact_phone is null
      )
    ),
  constraint fulfillment_centers_address_line2_check
    check (
      address_line2 is null
      or (
        char_length(btrim(address_line2)) between 1 and 500
        and address_line2 !~ '[[:cntrl:]]'
      )
    ),
  constraint fulfillment_centers_active_details_check
    check (
      status <> 'active'
      or (
        postal_code is not null
        and postal_code ~ '^[0-9]{5}$'
        and address_line1 is not null
        and char_length(btrim(address_line1)) between 5 and 500
        and address_line1 !~ '[[:cntrl:]]'
        and contact_name is not null
        and char_length(btrim(contact_name)) between 1 and 80
        and contact_name !~ '[[:cntrl:]]'
        and contact_phone is not null
        and char_length(btrim(contact_phone)) between 7 and 30
        and contact_phone !~ '[[:cntrl:]]'
      )
    )
);

create unique index fulfillment_centers_one_default_per_business_idx
  on public.fulfillment_centers (business_id)
  where is_default;

insert into public.fulfillment_centers (
  id,
  business_id,
  code,
  name,
  status,
  is_default
) values (
  '99000000-0000-4000-8000-000000000002'::uuid,
  '99000000-0000-4000-8000-000000000001'::uuid,
  'central-default',
  'NINETY-NINE 중앙 출고지',
  'configuration_required',
  true
);

create table public.store_fulfillment_works (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  order_id uuid not null,
  store_id uuid not null,
  fulfillment_center_id uuid not null,
  status text not null default 'waiting_payment'
    check (status in (
      'waiting_payment',
      'reconciliation_required',
      'preparing',
      'ready_for_transfer',
      'in_transit_to_center',
      'center_received',
      'issue',
      'cancelled',
      'legacy_terminal'
    )),
  version bigint not null default 0 check (version >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_fulfillment_works_business_id_fkey
    foreign key (business_id)
    references public.businesses (id)
    on delete restrict,
  constraint store_fulfillment_works_order_id_fkey
    foreign key (order_id)
    references public.commerce_orders (id)
    on delete restrict,
  constraint store_fulfillment_works_store_business_fkey
    foreign key (store_id, business_id)
    references public.stores (id, business_id)
    on delete restrict,
  constraint store_fulfillment_works_center_business_fkey
    foreign key (fulfillment_center_id, business_id)
    references public.fulfillment_centers (id, business_id)
    on delete restrict,
  constraint store_fulfillment_works_order_store_key
    unique (order_id, store_id),
  constraint store_fulfillment_works_identity_key
    unique (
      id,
      business_id,
      order_id,
      store_id,
      fulfillment_center_id
    ),
  constraint store_fulfillment_works_timestamp_order_check
    check (updated_at >= created_at)
);

create index store_fulfillment_works_store_queue_idx
  on public.store_fulfillment_works (
    store_id,
    status,
    updated_at,
    id
  );

create index store_fulfillment_works_center_queue_idx
  on public.store_fulfillment_works (
    fulfillment_center_id,
    status,
    updated_at,
    id
  );

create table public.order_item_fulfillments (
  order_item_id uuid primary key,
  business_id uuid not null,
  order_id uuid not null,
  store_id uuid not null,
  work_id uuid not null,
  fulfillment_center_id uuid not null,
  current_stage text not null
    check (current_stage in (
      'waiting_payment',
      'reconciliation_required',
      'preparing',
      'ready_for_transfer',
      'in_transit_to_center',
      'center_received',
      'center_stored',
      'cancelled',
      'legacy_terminal'
    )),
  location_kind text not null
    check (location_kind in ('store', 'transit', 'center', 'unknown')),
  storage_location_code text,
  is_blocked boolean not null default false,
  block_reason text,
  version bigint not null default 0 check (version >= 0),
  last_event_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_item_fulfillments_business_id_fkey
    foreign key (business_id)
    references public.businesses (id)
    on delete restrict,
  constraint order_item_fulfillments_order_item_identity_fkey
    foreign key (order_item_id, order_id, store_id)
    references public.commerce_order_items (id, order_id, store_id)
    on delete restrict,
  constraint order_item_fulfillments_work_identity_fkey
    foreign key (
      work_id,
      business_id,
      order_id,
      store_id,
      fulfillment_center_id
    )
    references public.store_fulfillment_works (
      id,
      business_id,
      order_id,
      store_id,
      fulfillment_center_id
    )
    on delete restrict,
  constraint order_item_fulfillments_timestamp_order_check
    check (updated_at >= created_at),
  constraint order_item_fulfillments_block_details_check
    check (
      (
        is_blocked
        and block_reason is not null
        and char_length(btrim(block_reason)) between 1 and 1000
      )
      or (
        not is_blocked
        and block_reason is null
      )
    ),
  constraint order_item_fulfillments_stage_location_check
    check (
      (
        current_stage in (
          'waiting_payment',
          'preparing',
          'ready_for_transfer'
        )
        and location_kind = 'store'
        and storage_location_code is null
      )
      or (
        current_stage = 'in_transit_to_center'
        and location_kind = 'transit'
        and storage_location_code is null
      )
      or (
        current_stage = 'center_received'
        and location_kind = 'center'
        and storage_location_code is null
      )
      or (
        current_stage = 'center_stored'
        and location_kind = 'center'
        and storage_location_code is not null
        and char_length(btrim(storage_location_code)) between 1 and 120
      )
      or (
        current_stage in (
          'reconciliation_required',
          'cancelled',
          'legacy_terminal'
        )
        and location_kind = 'unknown'
        and storage_location_code is null
      )
    )
);

create index order_item_fulfillments_work_queue_idx
  on public.order_item_fulfillments (
    work_id,
    current_stage,
    updated_at,
    order_item_id
  );

create index order_item_fulfillments_center_queue_idx
  on public.order_item_fulfillments (
    fulfillment_center_id,
    current_stage,
    updated_at,
    order_item_id
  );

create index order_item_fulfillments_storage_location_idx
  on public.order_item_fulfillments (
    fulfillment_center_id,
    storage_location_code,
    order_item_id
  )
  where current_stage = 'center_stored';

create table public.fulfillment_events (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null,
  sequence_no bigint not null check (sequence_no > 0),
  event_type text not null
    check (event_type in (
      'initialized',
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
    )),
  from_stage text
    check (
      from_stage is null
      or from_stage in (
        'waiting_payment',
        'reconciliation_required',
        'preparing',
        'ready_for_transfer',
        'in_transit_to_center',
        'center_received',
        'center_stored',
        'cancelled',
        'legacy_terminal'
      )
    ),
  to_stage text not null
    check (to_stage in (
      'waiting_payment',
      'reconciliation_required',
      'preparing',
      'ready_for_transfer',
      'in_transit_to_center',
      'center_received',
      'center_stored',
      'cancelled',
      'legacy_terminal'
    )),
  from_location_kind text
    check (
      from_location_kind is null
      or from_location_kind in ('store', 'transit', 'center', 'unknown')
    ),
  to_location_kind text not null
    check (to_location_kind in ('store', 'transit', 'center', 'unknown')),
  from_location_code text,
  to_location_code text,
  from_blocked boolean,
  to_blocked boolean not null,
  actor_kind text not null
    check (actor_kind in ('user', 'system', 'migration')),
  actor_user_id uuid,
  actor_role_snapshot text not null
    check (char_length(btrim(actor_role_snapshot)) between 1 and 80),
  idempotency_key uuid not null,
  reason_code text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  constraint fulfillment_events_order_item_id_fkey
    foreign key (order_item_id)
    references public.order_item_fulfillments (order_item_id)
    on delete restrict,
  constraint fulfillment_events_order_item_sequence_key
    unique (order_item_id, sequence_no),
  constraint fulfillment_events_order_item_idempotency_key
    unique (order_item_id, idempotency_key),
  constraint fulfillment_events_actor_check
    check (actor_kind <> 'user' or actor_user_id is not null),
  constraint fulfillment_events_reason_code_check
    check (
      reason_code is null
      or char_length(btrim(reason_code)) between 1 and 80
    ),
  constraint fulfillment_events_note_check
    check (
      note is null
      or char_length(btrim(note)) between 1 and 1000
    ),
  constraint fulfillment_events_metadata_check
    check (
      jsonb_typeof(metadata) = 'object'
      and octet_length(metadata::text) <= 8192
    ),
  constraint fulfillment_events_timestamp_order_check
    check (recorded_at >= occurred_at),
  constraint fulfillment_events_has_change_check
    check (
      from_stage is distinct from to_stage
      or from_location_kind is distinct from to_location_kind
      or from_location_code is distinct from to_location_code
      or from_blocked is distinct from to_blocked
    )
);

create index fulfillment_events_item_history_idx
  on public.fulfillment_events (order_item_id, sequence_no desc);

create index fulfillment_events_actor_history_idx
  on public.fulfillment_events (actor_user_id, occurred_at desc, id)
  where actor_user_id is not null;

create index fulfillment_events_type_history_idx
  on public.fulfillment_events (event_type, occurred_at desc, id);

create or replace function app_private.reject_fulfillment_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = '물류 이벤트 이력은 수정하거나 삭제할 수 없습니다.';
end;
$$;

revoke all on function app_private.reject_fulfillment_event_mutation()
from public, anon, authenticated, service_role;

create trigger fulfillment_events_append_only
before update or delete or truncate
on public.fulfillment_events
for each statement
execute function app_private.reject_fulfillment_event_mutation();

-- Existing expiration timestamps and payment status do not prove physical
-- receipt at the center. Only cancellation and an existing shipped fact are
-- classified; everything else is held for explicit reconciliation.
with classified_items as (
  select
    items.id as order_item_id,
    items.order_id,
    items.store_id,
    stores.business_id,
    case
      when items.payment_status = 'cancelled' then 'cancelled'
      when orders.status = 'shipped'
        or exists (
          select 1
          from public.shipping_request_items as shipping_items
          join public.shipping_requests as shipping_requests
            on shipping_requests.id = shipping_items.request_id
          where shipping_items.product_id = items.product_id
            and shipping_requests.status = 'shipped'
        )
        then 'legacy_terminal'
      else 'reconciliation_required'
    end as initial_stage
  from public.commerce_order_items as items
  join public.commerce_orders as orders
    on orders.id = items.order_id
  join public.stores as stores
    on stores.id = items.store_id
)
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
  classified.business_id,
  classified.order_id,
  classified.store_id,
  centers.id,
  case
    when bool_and(classified.initial_stage = 'cancelled')
      then 'cancelled'
    when bool_and(classified.initial_stage in ('cancelled', 'legacy_terminal'))
      then 'legacy_terminal'
    else 'reconciliation_required'
  end,
  1,
  transaction_timestamp(),
  transaction_timestamp()
from classified_items as classified
join public.fulfillment_centers as centers
  on centers.business_id = classified.business_id
  and centers.is_default
group by
  classified.business_id,
  classified.order_id,
  classified.store_id,
  centers.id;

with classified_items as (
  select
    items.id as order_item_id,
    items.order_id,
    items.store_id,
    stores.business_id,
    case
      when items.payment_status = 'cancelled' then 'cancelled'
      when orders.status = 'shipped'
        or exists (
          select 1
          from public.shipping_request_items as shipping_items
          join public.shipping_requests as shipping_requests
            on shipping_requests.id = shipping_items.request_id
          where shipping_items.product_id = items.product_id
            and shipping_requests.status = 'shipped'
        )
        then 'legacy_terminal'
      else 'reconciliation_required'
    end as initial_stage
  from public.commerce_order_items as items
  join public.commerce_orders as orders
    on orders.id = items.order_id
  join public.stores as stores
    on stores.id = items.store_id
)
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
  classified.order_item_id,
  classified.business_id,
  classified.order_id,
  classified.store_id,
  works.id,
  works.fulfillment_center_id,
  classified.initial_stage,
  'unknown',
  false,
  1,
  transaction_timestamp(),
  transaction_timestamp(),
  transaction_timestamp()
from classified_items as classified
join public.store_fulfillment_works as works
  on works.business_id = classified.business_id
  and works.order_id = classified.order_id
  and works.store_id = classified.store_id;

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
  fulfillment.order_item_id,
  1,
  'legacy_imported',
  null,
  fulfillment.current_stage,
  null,
  fulfillment.location_kind,
  null,
  null,
  null,
  false,
  'migration',
  null,
  'migration',
  gen_random_uuid(),
  'foundation_backfill',
  jsonb_strip_nulls(jsonb_build_object(
    'source_migration', '20260722030000_add_central_fulfillment_foundation',
    'observed_item_payment_status', items.payment_status,
    'observed_order_status', orders.status,
    'observed_storage_expires_at', items.storage_expires_at,
    'observed_shipped_evidence', (
      orders.status = 'shipped'
      or exists (
        select 1
        from public.shipping_request_items as shipping_items
        join public.shipping_requests as shipping_requests
          on shipping_requests.id = shipping_items.request_id
        where shipping_items.product_id = items.product_id
          and shipping_requests.status = 'shipped'
      )
    )
  )),
  transaction_timestamp(),
  transaction_timestamp()
from public.order_item_fulfillments as fulfillment
join public.commerce_order_items as items
  on items.id = fulfillment.order_item_id
join public.commerce_orders as orders
  on orders.id = items.order_id;

do $$
declare
  v_order_item_count bigint;
  v_fulfillment_count bigint;
  v_event_count bigint;
begin
  select count(*) into v_order_item_count
  from public.commerce_order_items;

  select count(*) into v_fulfillment_count
  from public.order_item_fulfillments;

  select count(*) into v_event_count
  from public.fulfillment_events
  where event_type = 'legacy_imported'
    and sequence_no = 1;

  if v_fulfillment_count <> v_order_item_count
    or v_event_count <> v_order_item_count
  then
    raise exception using
      errcode = '23514',
      message = '기존 주문 상품의 중앙 출고 reconciliation backfill이 완전하지 않습니다.';
  end if;

  if exists (
    select 1
    from public.order_item_fulfillments as fulfillment
    join public.commerce_order_items as items
      on items.id = fulfillment.order_item_id
    where (
      items.payment_status = 'cancelled'
      and fulfillment.current_stage <> 'cancelled'
    ) or (
      items.payment_status <> 'cancelled'
      and fulfillment.current_stage not in (
        'reconciliation_required',
        'legacy_terminal'
      )
    ) or fulfillment.location_kind <> 'unknown'
  ) then
    raise exception using
      errcode = '23514',
      message = '기존 주문 상품에 추정된 물리 위치가 포함되었습니다.';
  end if;
end;
$$;

alter table public.businesses enable row level security;
alter table public.businesses force row level security;
alter table public.fulfillment_centers enable row level security;
alter table public.fulfillment_centers force row level security;
alter table public.store_fulfillment_works enable row level security;
alter table public.store_fulfillment_works force row level security;
alter table public.order_item_fulfillments enable row level security;
alter table public.order_item_fulfillments force row level security;
alter table public.fulfillment_events enable row level security;
alter table public.fulfillment_events force row level security;

revoke all privileges on table
  public.businesses,
  public.fulfillment_centers,
  public.store_fulfillment_works,
  public.order_item_fulfillments,
  public.fulfillment_events
from public, anon, authenticated, service_role;

grant select on table
  public.businesses,
  public.fulfillment_centers,
  public.store_fulfillment_works,
  public.order_item_fulfillments,
  public.fulfillment_events
to authenticated;

create policy "Owners read businesses"
on public.businesses
for select
to authenticated
using ((select public.is_owner()));

create policy "Owners read fulfillment centers"
on public.fulfillment_centers
for select
to authenticated
using ((select public.is_owner()));

create policy "Owners read store fulfillment works"
on public.store_fulfillment_works
for select
to authenticated
using ((select public.is_owner()));

create policy "Owners read order item fulfillments"
on public.order_item_fulfillments
for select
to authenticated
using ((select public.is_owner()));

create policy "Owners read fulfillment events"
on public.fulfillment_events
for select
to authenticated
using ((select public.is_owner()));

comment on table public.businesses is
  'Single-business ownership boundary for stores and central fulfillment.';
comment on table public.fulfillment_centers is
  'Central fulfillment locations. The seeded default remains unusable until its real address is configured.';
comment on table public.store_fulfillment_works is
  'Per-order, per-store internal preparation and transfer work; never a customer order or payment.';
comment on table public.order_item_fulfillments is
  'Current physical fulfillment projection for one commerce order item.';
comment on table public.fulfillment_events is
  'Append-only item-level fulfillment and physical-location history.';
comment on column public.order_item_fulfillments.current_stage is
  'Legacy rows remain reconciliation_required unless cancellation or shipped evidence is explicit.';

commit;
