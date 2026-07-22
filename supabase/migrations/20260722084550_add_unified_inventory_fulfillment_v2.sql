begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

-- Unified inventory/fulfillment v2 is additive.  The previous canonical
-- commerce shipment tables remain immutable compatibility history, but all new
-- item-selected shipments use the aggregates below.

alter table public.shipping_fee_payments
  add column business_id uuid references public.businesses (id) on delete restrict,
  add column inventory_shipment_id uuid,
  add column version bigint not null default 0 check(version>=0);

alter table public.commerce_order_transfers add column version bigint not null default 0 check(version>=0);
alter table public.manual_transfer_orders add column version bigint not null default 0 check(version>=0);

alter table public.shipping_credit_ledger
  add column business_id uuid references public.businesses (id) on delete restrict,
  add column inventory_shipment_id uuid;

create table public.store_fulfillment_routes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  store_id uuid not null,
  fulfillment_center_id uuid not null,
  route_mode text not null check (route_mode in ('transfer', 'co_located')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  version bigint not null default 0 check (version >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint store_fulfillment_routes_store_business_fkey
    foreign key (store_id, business_id)
    references public.stores (id, business_id) on delete restrict,
  constraint store_fulfillment_routes_center_business_fkey
    foreign key (fulfillment_center_id, business_id)
    references public.fulfillment_centers (id, business_id) on delete restrict,
  constraint store_fulfillment_routes_store_key unique (store_id),
  constraint store_fulfillment_routes_identity_key
    unique (id, business_id, store_id, fulfillment_center_id),
  constraint store_fulfillment_routes_time_check check (updated_at >= created_at)
);

create table public.store_fulfillment_route_events (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.store_fulfillment_routes (id) on delete restrict,
  sequence_no bigint not null check (sequence_no > 0),
  event_type text not null check (event_type in ('configured', 'updated', 'deactivated')),
  actor_user_id uuid not null references public.profiles (id) on delete restrict,
  idempotency_key uuid not null,
  reason text,
  from_snapshot jsonb,
  to_snapshot jsonb not null,
  occurred_at timestamptz not null default clock_timestamp(),
  unique (route_id, sequence_no),
  unique (actor_user_id, idempotency_key),
  check (from_snapshot is null or jsonb_typeof(from_snapshot) = 'object'),
  check (jsonb_typeof(to_snapshot) = 'object')
);

create table public.fulfillment_center_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  fulfillment_center_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'inactive')),
  receive_at_center boolean not null default false,
  create_shipments boolean not null default false,
  version bigint not null default 0 check (version >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint fulfillment_center_staff_assignments_center_business_fkey
    foreign key (fulfillment_center_id, business_id)
    references public.fulfillment_centers (id, business_id) on delete restrict,
  constraint fulfillment_center_staff_assignments_center_user_key
    unique (fulfillment_center_id, user_id),
  constraint fulfillment_center_staff_assignments_time_check
    check (updated_at >= created_at)
);

create index fulfillment_center_staff_assignments_user_scope_idx
  on public.fulfillment_center_staff_assignments
  (user_id, status, business_id, fulfillment_center_id);

create table public.inventory_fulfillment_rollout_settings (
  business_id uuid primary key references public.businesses(id) on delete restrict,
  entitlement_projection_enabled boolean not null default false,
  unified_inventory_reads_enabled boolean not null default false,
  item_selected_shipments_enabled boolean not null default false,
  shipping_fee_amount bigint not null default 3500 check(shipping_fee_amount between 1 and 1000000),
  version bigint not null default 0 check(version>=0),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

insert into public.inventory_fulfillment_rollout_settings(business_id)
select id from public.businesses on conflict(business_id) do nothing;

create table public.inventory_command_receipts (
  actor_user_id uuid not null references public.profiles (id) on delete restrict,
  idempotency_key uuid not null,
  command_name text not null check (command_name in (
    'confirm_payment', 'request_shipment', 'release_store_items',
    'center_receive', 'center_store', 'pack_shipment', 'ship_shipment',
    'open_exception', 'resolve_exception', 'submit_refund_account',
    'review_refund', 'refund_account_access', 'append_exception_evidence',
    'configure_rollout', 'review_shipping_fee_refund', 'reconcile_inventory_item',
    'release_paid_items', 'submit_shipping_fee_refund_account', 'shipping_fee_refund_account_access',
    'configure_center_assignment'
  )),
  target_id uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (actor_user_id, idempotency_key)
);

create table public.customer_inventory_items (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete restrict,
  business_id uuid not null references public.businesses (id) on delete restrict,
  origin_store_id uuid not null,
  product_id uuid not null references public.products (id) on delete restrict,
  fulfillment_center_id uuid,
  route_mode text check (route_mode in ('transfer', 'co_located')),
  route_version bigint check (route_version >= 0),
  source_kind text not null check (source_kind in ('commerce', 'auction', 'legacy_portone')),
  commerce_order_item_id uuid references public.commerce_order_items (id) on delete restrict,
  manual_transfer_order_id uuid references public.manual_transfer_orders (id) on delete restrict,
  legacy_payment_order_id uuid references public.payment_orders (id) on delete restrict,
  legacy_commerce_shipment_id uuid references public.commerce_shipments (id) on delete restrict,
  paid_amount bigint not null check (paid_amount > 0),
  currency text not null default 'KRW' check (currency = 'KRW'),
  paid_at timestamptz not null,
  storage_class_snapshot text not null check (storage_class_snapshot in ('small', 'large')),
  storage_duration_days integer not null check (storage_duration_days in (7, 14)),
  work_due_date date not null,
  storage_started_at timestamptz,
  storage_expires_at timestamptz,
  ownership_status text not null default 'active'
    check (ownership_status in ('active', 'refund_pending', 'refunded', 'cancelled')),
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint customer_inventory_items_store_business_fkey
    foreign key (origin_store_id, business_id)
    references public.stores (id, business_id) on delete restrict,
  constraint customer_inventory_items_center_business_fkey
    foreign key (fulfillment_center_id, business_id)
    references public.fulfillment_centers (id, business_id) on delete restrict,
  constraint customer_inventory_items_source_xor_check check (
    num_nonnulls(commerce_order_item_id, manual_transfer_order_id, legacy_payment_order_id) = 1
    and ((source_kind = 'commerce' and commerce_order_item_id is not null)
      or (source_kind = 'auction' and manual_transfer_order_id is not null)
      or (source_kind = 'legacy_portone' and legacy_payment_order_id is not null))
  ),
  constraint customer_inventory_items_route_check check (
    (fulfillment_center_id is null and route_mode is null and route_version is null)
    or (fulfillment_center_id is not null and route_mode is not null and route_version is not null)
  ),
  constraint customer_inventory_items_storage_check check (
    (storage_started_at is null and storage_expires_at is null)
    or (storage_started_at is not null and storage_expires_at = storage_started_at + make_interval(days => storage_duration_days))
  ),
  constraint customer_inventory_items_time_check check (updated_at >= created_at and paid_at <= updated_at),
  unique (id, member_id, business_id, origin_store_id, product_id)
);

alter table public.customer_inventory_items
  add constraint customer_inventory_items_fulfillment_identity_key
  unique (id, business_id, origin_store_id);

create unique index customer_inventory_items_commerce_source_idx
  on public.customer_inventory_items (commerce_order_item_id)
  where commerce_order_item_id is not null;
create unique index customer_inventory_items_auction_source_idx
  on public.customer_inventory_items (manual_transfer_order_id)
  where manual_transfer_order_id is not null;
create unique index customer_inventory_items_legacy_source_idx
  on public.customer_inventory_items (legacy_payment_order_id)
  where legacy_payment_order_id is not null;
create unique index customer_inventory_items_active_product_idx
  on public.customer_inventory_items (product_id)
  where ownership_status in ('active', 'refund_pending');
create index customer_inventory_items_member_status_idx
  on public.customer_inventory_items (member_id, ownership_status, paid_at desc, id);
create index customer_inventory_items_store_status_idx
  on public.customer_inventory_items (origin_store_id, ownership_status, paid_at, id);
create index customer_inventory_items_legacy_shipment_idx
  on public.customer_inventory_items (legacy_commerce_shipment_id)
  where legacy_commerce_shipment_id is not null;

create table public.inventory_item_fulfillments (
  inventory_item_id uuid primary key,
  business_id uuid not null,
  origin_store_id uuid not null,
  fulfillment_center_id uuid,
  route_mode text check (route_mode in ('transfer', 'co_located')),
  current_stage text not null check (current_stage in (
    'reconciliation_required', 'entitled', 'preparing', 'in_transit_to_center',
    'center_received', 'center_stored', 'packed', 'shipped', 'cancelled'
  )),
  location_kind text not null check (location_kind in ('store', 'transit', 'center', 'unknown')),
  storage_location_code text,
  outbound_released boolean not null default false,
  is_blocked boolean not null default false,
  block_reason text,
  version bigint not null default 0 check (version >= 0),
  last_event_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint inventory_item_fulfillments_item_identity_fkey
    foreign key (inventory_item_id, business_id, origin_store_id)
    references public.customer_inventory_items (id, business_id, origin_store_id) on delete restrict,
  constraint inventory_item_fulfillments_center_business_fkey
    foreign key (fulfillment_center_id, business_id)
    references public.fulfillment_centers (id, business_id) on delete restrict,
  constraint inventory_item_fulfillments_route_check check (
    (current_stage = 'reconciliation_required' and fulfillment_center_id is null and route_mode is null and location_kind = 'unknown')
    or (current_stage in ('entitled','preparing') and fulfillment_center_id is not null and route_mode is not null and location_kind = 'store')
    or (current_stage = 'in_transit_to_center' and fulfillment_center_id is not null and route_mode = 'transfer' and location_kind = 'transit')
    or (current_stage in ('center_received', 'center_stored', 'packed') and fulfillment_center_id is not null and route_mode is not null and location_kind = 'center')
    or (current_stage = 'shipped' and fulfillment_center_id is not null and route_mode is not null and location_kind = 'transit')
    or (current_stage = 'cancelled' and location_kind = 'unknown')
  ),
  constraint inventory_item_fulfillments_storage_check check (
    (current_stage = 'center_stored' and storage_location_code is not null and btrim(storage_location_code) <> '')
    or (current_stage <> 'center_stored' and storage_location_code is null)
  ),
  constraint inventory_item_fulfillments_block_check check (
    (is_blocked and block_reason is not null and char_length(btrim(block_reason)) between 1 and 1000)
    or (not is_blocked and block_reason is null)
  ),
  unique (inventory_item_id, business_id, origin_store_id, fulfillment_center_id)
);

create index inventory_item_fulfillments_store_queue_idx
  on public.inventory_item_fulfillments (origin_store_id, current_stage, updated_at, inventory_item_id);
create index inventory_item_fulfillments_center_queue_idx
  on public.inventory_item_fulfillments (fulfillment_center_id, current_stage, updated_at, inventory_item_id);

create table public.inventory_item_fulfillment_events (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_item_fulfillments (inventory_item_id) on delete restrict,
  sequence_no bigint not null check (sequence_no > 0),
  event_type text not null check (event_type in (
    'entitled', 'reconciliation_required', 'released_from_store', 'onsite_handover',
    'received_at_center', 'stored_at_center', 'packed', 'shipped',
    'exception_opened', 'exception_resolved', 'refund_completed', 'cancelled'
  )),
  from_stage text,
  to_stage text not null,
  from_location_kind text,
  to_location_kind text not null,
  actor_kind text not null check (actor_kind in ('user', 'system', 'migration')),
  actor_user_id uuid,
  idempotency_key uuid not null,
  reason_code text,
  note text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default clock_timestamp(),
  unique (inventory_item_id, sequence_no),
  unique (inventory_item_id, idempotency_key),
  check (actor_kind <> 'user' or actor_user_id is not null)
);

create index inventory_item_fulfillment_events_history_idx
  on public.inventory_item_fulfillment_events (inventory_item_id, sequence_no desc);

create table public.inventory_shipments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete restrict,
  business_id uuid not null references public.businesses (id) on delete restrict,
  fulfillment_center_id uuid not null,
  status text not null default 'collecting' check (status in (
    'requested', 'collecting', 'ready_to_pack', 'packed', 'shipped', 'cancelled', 'reconciliation_required'
  )),
  settlement_method text not null check (settlement_method in ('shipping_credit', 'manual_transfer', 'waiver')),
  shipping_fee_payment_id uuid references public.shipping_fee_payments (id) on delete restrict,
  shipping_credit_ledger_id uuid references public.shipping_credit_ledger (id) on delete restrict,
  shipping_fee_waiver_id uuid,
  address_id uuid references public.shipping_addresses (id) on delete set null,
  address_snapshot jsonb not null check (jsonb_typeof(address_snapshot) = 'object'),
  courier text,
  tracking_number text,
  packed_at timestamptz,
  packed_by uuid references public.profiles (id) on delete restrict,
  shipped_at timestamptz,
  shipped_by uuid references public.profiles (id) on delete restrict,
  cancelled_at timestamptz,
  cancellation_reason text,
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint inventory_shipments_center_business_fkey
    foreign key (fulfillment_center_id, business_id)
    references public.fulfillment_centers (id, business_id) on delete restrict,
  constraint inventory_shipments_settlement_check check (
    num_nonnulls(shipping_fee_payment_id, shipping_credit_ledger_id, shipping_fee_waiver_id) = 1
    and ((settlement_method = 'manual_transfer' and shipping_fee_payment_id is not null)
      or (settlement_method = 'shipping_credit' and shipping_credit_ledger_id is not null)
      or (settlement_method = 'waiver' and shipping_fee_waiver_id is not null))
  ),
  constraint inventory_shipments_status_details_check check (
    (status in ('requested', 'collecting', 'ready_to_pack', 'reconciliation_required')
      and courier is null and tracking_number is null and packed_at is null and packed_by is null
      and shipped_at is null and shipped_by is null and cancelled_at is null and cancellation_reason is null)
    or (status = 'packed' and courier is null and tracking_number is null and packed_at is not null and packed_by is not null
      and shipped_at is null and shipped_by is null and cancelled_at is null and cancellation_reason is null)
    or (status = 'shipped' and courier is not null and tracking_number is not null and packed_at is not null and packed_by is not null
      and shipped_at is not null and shipped_by is not null and cancelled_at is null and cancellation_reason is null)
    or (status = 'cancelled' and cancelled_at is not null and cancellation_reason is not null)
  ),
  unique (id, member_id, business_id, fulfillment_center_id)
);

create unique index inventory_shipments_tracking_idx
  on public.inventory_shipments (lower(btrim(courier)), btrim(tracking_number))
  where status = 'shipped';
create index inventory_shipments_member_idx
  on public.inventory_shipments (member_id, created_at desc, id);
create index inventory_shipments_queue_idx
  on public.inventory_shipments (business_id, status, updated_at, id);

create table public.inventory_shipment_items (
  shipment_id uuid not null,
  inventory_item_id uuid not null,
  member_id uuid not null,
  business_id uuid not null,
  fulfillment_center_id uuid not null,
  product_id uuid not null,
  origin_store_id uuid not null,
  line_status text not null default 'requested' check (line_status in (
    'requested', 'held', 'ready', 'excluded', 'packed', 'shipped', 'cancelled'
  )),
  excluded_reason text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (shipment_id, inventory_item_id),
  constraint inventory_shipment_items_shipment_identity_fkey
    foreign key (shipment_id, member_id, business_id, fulfillment_center_id)
    references public.inventory_shipments (id, member_id, business_id, fulfillment_center_id) on delete restrict,
  constraint inventory_shipment_items_inventory_identity_fkey
    foreign key (inventory_item_id, member_id, business_id, origin_store_id, product_id)
    references public.customer_inventory_items (id, member_id, business_id, origin_store_id, product_id) on delete restrict,
  constraint inventory_shipment_items_exclusion_check check (
    (line_status in ('excluded', 'cancelled') and excluded_reason is not null)
    or (line_status not in ('excluded', 'cancelled') and excluded_reason is null)
  )
);

create unique index inventory_shipment_items_one_active_idx
  on public.inventory_shipment_items (inventory_item_id)
  where line_status in ('requested', 'held', 'ready', 'packed');
create index inventory_shipment_items_store_idx
  on public.inventory_shipment_items (shipment_id, origin_store_id, line_status, inventory_item_id);

create table public.inventory_shipment_store_works (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.inventory_shipments (id) on delete restrict,
  business_id uuid not null references public.businesses (id) on delete restrict,
  origin_store_id uuid not null,
  fulfillment_center_id uuid not null,
  route_mode text not null check (route_mode in ('transfer', 'co_located')),
  status text not null default 'collecting' check (status in ('collecting', 'outbound_complete', 'cancelled')),
  version bigint not null default 0 check (version >= 0),
  completed_at timestamptz,
  completed_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint inventory_shipment_store_works_store_business_fkey
    foreign key (origin_store_id, business_id)
    references public.stores (id, business_id) on delete restrict,
  constraint inventory_shipment_store_works_center_business_fkey
    foreign key (fulfillment_center_id, business_id)
    references public.fulfillment_centers (id, business_id) on delete restrict,
  unique (shipment_id, origin_store_id),
  unique (id, shipment_id, origin_store_id),
  check ((status = 'outbound_complete' and completed_at is not null and completed_by is not null)
    or (status <> 'outbound_complete' and completed_at is null and completed_by is null))
);

create index inventory_shipment_store_works_queue_idx
  on public.inventory_shipment_store_works (origin_store_id, status, updated_at, id);

create table public.inventory_shipment_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.inventory_shipments (id) on delete restrict,
  sequence_no bigint not null check (sequence_no > 0),
  event_type text not null check (event_type in (
    'requested', 'store_items_released', 'ready_to_pack', 'packed', 'shipped',
    'line_held', 'line_resumed', 'line_excluded', 'cancelled', 'reconciliation_required'
  )),
  from_status text,
  to_status text not null,
  actor_kind text not null check (actor_kind in ('user', 'system', 'migration')),
  actor_user_id uuid,
  idempotency_key uuid not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default clock_timestamp(),
  unique (shipment_id, sequence_no),
  unique (shipment_id, idempotency_key),
  check (actor_kind <> 'user' or actor_user_id is not null)
);

create index inventory_shipment_events_history_idx
  on public.inventory_shipment_events (shipment_id, sequence_no desc);

create table public.inventory_exception_cases (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.customer_inventory_items (id) on delete restrict,
  shipment_id uuid references public.inventory_shipments (id) on delete restrict,
  business_id uuid not null references public.businesses (id) on delete restrict,
  origin_store_id uuid not null references public.stores (id) on delete restrict,
  kind text not null check (kind in ('inspection_required', 'missing', 'offline_sold', 'additional_wait', 'refund_required')),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution text check (resolution in ('resume', 'exclude_for_later', 'refund')),
  public_reason text not null check (char_length(btrim(public_reason)) between 3 and 1000),
  internal_note text check (internal_note is null or char_length(btrim(internal_note)) between 1 and 2000),
  review_due_at timestamptz,
  evidence_paths text[] not null default '{}',
  opened_by uuid not null references public.profiles (id) on delete restrict,
  resolved_by uuid references public.profiles (id) on delete restrict,
  resolved_at timestamptz,
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((status = 'open' and resolution is null and resolved_by is null and resolved_at is null)
    or (status = 'resolved' and resolution is not null and resolved_by is not null and resolved_at is not null))
);

create unique index inventory_exception_cases_one_open_idx
  on public.inventory_exception_cases (inventory_item_id)
  where status = 'open';
create index inventory_exception_cases_queue_idx
  on public.inventory_exception_cases (business_id, status, review_due_at, created_at, id);

create table public.inventory_exception_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.inventory_exception_cases (id) on delete restrict,
  sequence_no bigint not null check (sequence_no > 0),
  event_type text not null check (event_type in ('opened', 'evidence_appended', 'resolved')),
  actor_user_id uuid not null references public.profiles (id) on delete restrict,
  idempotency_key uuid not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default clock_timestamp(),
  unique (case_id, sequence_no),
  unique (case_id, idempotency_key)
);

create table public.manual_refunds (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.customer_inventory_items (id) on delete restrict,
  exception_case_id uuid not null unique references public.inventory_exception_cases (id) on delete restrict,
  member_id uuid not null references public.profiles (id) on delete restrict,
  business_id uuid not null references public.businesses (id) on delete restrict,
  origin_store_id uuid not null references public.stores (id) on delete restrict,
  amount bigint not null check (amount > 0),
  currency text not null default 'KRW' check (currency = 'KRW'),
  status text not null default 'requested' check (status in ('requested', 'approved', 'completed', 'cancelled')),
  requested_by uuid not null references public.profiles (id) on delete restrict,
  approved_by uuid references public.profiles (id) on delete restrict,
  approved_at timestamptz,
  completed_by uuid references public.profiles (id) on delete restrict,
  completed_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete restrict,
  cancelled_at timestamptz,
  transfer_reference text,
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((status = 'requested' and approved_by is null and approved_at is null and completed_by is null and completed_at is null and cancelled_by is null and cancelled_at is null)
    or (status = 'approved' and approved_by is not null and approved_at is not null and completed_by is null and completed_at is null and cancelled_by is null and cancelled_at is null)
    or (status = 'completed' and approved_by is not null and approved_at is not null and completed_by is not null and completed_at is not null and transfer_reference is not null and cancelled_by is null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_by is not null and cancelled_at is not null and completed_by is null and completed_at is null))
);

create index manual_refunds_queue_idx
  on public.manual_refunds (business_id, status, created_at, id);
create unique index manual_refunds_one_active_item_idx on public.manual_refunds(inventory_item_id) where status in ('requested','approved');

create table public.manual_refund_accounts (
  refund_id uuid primary key references public.manual_refunds (id) on delete restrict,
  member_id uuid not null references public.profiles (id) on delete restrict,
  account_ciphertext text,
  account_initialization_vector text,
  account_authentication_tag text,
  account_key_version integer,
  account_fingerprint text,
  masked_account_number text not null check (masked_account_number ~ '^\*{4}[0-9]{4}$'),
  account_submitted_at timestamptz not null,
  account_expires_at timestamptz not null,
  cleared_at timestamptz,
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((cleared_at is null and account_ciphertext is not null and account_initialization_vector is not null
      and account_authentication_tag is not null and account_key_version is not null
      and account_fingerprint ~ '^[0-9a-f]{64}$')
    or (cleared_at is not null and account_ciphertext is null and account_initialization_vector is null
      and account_authentication_tag is null and account_key_version is null and account_fingerprint is null)),
  check (account_expires_at > account_submitted_at)
);

create table public.manual_refund_events (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid not null references public.manual_refunds (id) on delete restrict,
  sequence_no bigint not null check (sequence_no > 0),
  event_type text not null check (event_type in ('requested', 'account_submitted', 'account_accessed', 'approved', 'completed', 'cancelled')),
  actor_user_id uuid not null references public.profiles (id) on delete restrict,
  idempotency_key uuid not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default clock_timestamp(),
  unique (refund_id, sequence_no),
  unique (refund_id, idempotency_key)
);

create table public.manual_refund_disbursements (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid not null unique references public.manual_refunds(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  origin_store_id uuid not null references public.stores(id) on delete restrict,
  amount bigint not null check(amount>0),
  currency text not null default 'KRW' check(currency='KRW'),
  external_reference text not null unique check(char_length(btrim(external_reference)) between 3 and 200),
  disbursed_by uuid not null references public.profiles(id) on delete restrict,
  disbursed_at timestamptz not null default clock_timestamp(),
  idempotency_key uuid not null unique
);

create table public.shipping_fee_refunds (
  id uuid primary key default gen_random_uuid(),
  inventory_shipment_id uuid not null unique references public.inventory_shipments(id) on delete restrict,
  shipping_fee_payment_id uuid not null unique references public.shipping_fee_payments(id) on delete restrict,
  member_id uuid not null references public.profiles(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  amount bigint not null check(amount>0),
  status text not null default 'requested' check(status in ('requested','completed','cancelled')),
  version bigint not null default 0 check(version>=0),
  created_at timestamptz not null default clock_timestamp()
);

create table public.shipping_fee_refund_disbursements (
  id uuid primary key default gen_random_uuid(),
  shipping_fee_refund_id uuid not null unique references public.shipping_fee_refunds(id) on delete restrict,
  external_reference text not null unique check(char_length(btrim(external_reference)) between 3 and 200),
  amount bigint not null check(amount>0),
  disbursed_by uuid not null references public.profiles(id) on delete restrict,
  disbursed_at timestamptz not null default clock_timestamp(),
  idempotency_key uuid not null unique
);

create table public.shipping_fee_refund_accounts (
  shipping_fee_refund_id uuid primary key references public.shipping_fee_refunds(id) on delete restrict,
  member_id uuid not null references public.profiles(id) on delete restrict,
  account_ciphertext text not null,
  account_initialization_vector text not null,
  account_authentication_tag text not null,
  account_key_version integer not null check(account_key_version between 1 and 1000000),
  account_fingerprint text not null check(account_fingerprint ~ '^[0-9a-f]{64}$'),
  masked_account_number text not null check(masked_account_number ~ '^\*{4}[0-9]{4}$'),
  account_submitted_at timestamptz not null,
  account_expires_at timestamptz not null check(account_expires_at>account_submitted_at),
  version bigint not null default 0 check(version>=0)
);

create table public.shipping_fee_refund_events (
 id uuid primary key default gen_random_uuid(),
 shipping_fee_refund_id uuid not null references public.shipping_fee_refunds(id) on delete restrict,
 sequence_no bigint not null check(sequence_no>0),
 event_type text not null check(event_type in ('account_submitted','account_accessed','completed','cancelled')),
 actor_user_id uuid not null references public.profiles(id) on delete restrict,
 idempotency_key uuid not null,
 metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
 occurred_at timestamptz not null default clock_timestamp(),
 unique(shipping_fee_refund_id,sequence_no),unique(shipping_fee_refund_id,idempotency_key)
);

create table public.shipping_fee_waiver_entitlements (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete restrict,
  business_id uuid not null references public.businesses (id) on delete restrict,
  exception_case_id uuid not null unique references public.inventory_exception_cases (id) on delete restrict,
  status text not null default 'available' check (status in ('available', 'consumed', 'cancelled')),
  consumed_shipment_id uuid unique references public.inventory_shipments (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  consumed_at timestamptz,
  check ((status = 'available' and consumed_shipment_id is null and consumed_at is null)
    or (status = 'consumed' and consumed_shipment_id is not null and consumed_at is not null)
    or status = 'cancelled')
);

alter table public.inventory_shipments
  add constraint inventory_shipments_waiver_fkey
  foreign key (shipping_fee_waiver_id)
  references public.shipping_fee_waiver_entitlements (id) on delete restrict;

create table public.store_financial_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  origin_store_id uuid references public.stores (id) on delete restrict,
  inventory_item_id uuid references public.customer_inventory_items (id) on delete restrict,
  inventory_shipment_id uuid references public.inventory_shipments (id) on delete restrict,
  manual_refund_id uuid references public.manual_refunds (id) on delete restrict,
  entry_kind text not null check (entry_kind in ('item_payment', 'payment_reversal', 'item_refund', 'shipping_fee', 'shipping_fee_refund')),
  amount bigint not null check (amount <> 0),
  currency text not null default 'KRW' check (currency = 'KRW'),
  occurred_at timestamptz not null,
  idempotency_key uuid not null unique,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  check ((entry_kind = 'item_payment' and amount > 0 and origin_store_id is not null and inventory_item_id is not null and manual_refund_id is null)
    or (entry_kind = 'item_refund' and amount < 0 and origin_store_id is not null and inventory_item_id is not null and manual_refund_id is not null)
    or (entry_kind = 'payment_reversal' and amount < 0 and origin_store_id is not null and inventory_item_id is not null and manual_refund_id is null)
    or (entry_kind = 'shipping_fee' and amount > 0 and origin_store_id is null and inventory_shipment_id is not null)
    or (entry_kind = 'shipping_fee_refund' and amount < 0 and origin_store_id is null and inventory_shipment_id is not null))
);

create index store_financial_entries_store_time_idx
  on public.store_financial_entries (origin_store_id, occurred_at desc, id)
  where origin_store_id is not null;
create index store_financial_entries_business_time_idx
  on public.store_financial_entries (business_id, occurred_at desc, id);

alter table public.shipping_fee_payments
  add constraint shipping_fee_payments_inventory_shipment_fkey
    foreign key (inventory_shipment_id) references public.inventory_shipments (id) on delete restrict,
  add constraint shipping_fee_payments_v2_target_xor_check
    check (num_nonnulls(shipping_request_id, inventory_shipment_id) <= 1);

alter table public.shipping_credit_ledger
  add constraint shipping_credit_ledger_inventory_shipment_fkey
    foreign key (inventory_shipment_id) references public.inventory_shipments (id) on delete restrict,
  add constraint shipping_credit_ledger_v2_target_xor_check
    check (num_nonnulls(shipping_request_id, inventory_shipment_id) <= 1),
  add constraint shipping_credit_ledger_v2_usage_check
    check (inventory_shipment_id is null or (reason = 'used' and delta = -1));

create unique index shipping_fee_payments_one_inventory_shipment_idx
  on public.shipping_fee_payments (inventory_shipment_id)
  where inventory_shipment_id is not null;
create unique index shipping_credit_ledger_one_inventory_shipment_idx
  on public.shipping_credit_ledger (inventory_shipment_id)
  where inventory_shipment_id is not null;
create index shipping_fee_payments_business_status_idx
  on public.shipping_fee_payments (business_id, status, requested_at, id)
  where business_id is not null;
create index shipping_credit_ledger_business_idx
  on public.shipping_credit_ledger (business_id, created_at, id)
  where business_id is not null;

-- Refund state is distinct from paid/partially-paid settlement state.
alter table public.commerce_orders
  drop constraint commerce_orders_status_check;
alter table public.commerce_orders
  add constraint commerce_orders_status_check
  check (status in (
    'awaiting_payment', 'paid', 'partially_paid', 'cancelled', 'shipped',
    'partially_refunded', 'refunded'
  ));

-- Common safety helpers -----------------------------------------------------

create or replace function app_private.inventory_v2_fingerprint(p_value jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(p_value::text, 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function app_private.lock_inventory_shipment(p_shipment_id uuid)
returns void
language sql
volatile
strict
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('inventory-shipment:' || p_shipment_id::text, 0)
  );
$$;

create or replace function app_private.reject_inventory_v2_append_only_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = '감사 및 재무 이력은 수정하거나 삭제할 수 없습니다.';
end;
$$;

create trigger store_fulfillment_route_events_append_only before update or delete or truncate on public.store_fulfillment_route_events for each statement execute function app_private.reject_inventory_v2_append_only_mutation();
create trigger inventory_item_fulfillment_events_append_only before update or delete or truncate on public.inventory_item_fulfillment_events for each statement execute function app_private.reject_inventory_v2_append_only_mutation();
create trigger inventory_shipment_events_append_only before update or delete or truncate on public.inventory_shipment_events for each statement execute function app_private.reject_inventory_v2_append_only_mutation();
create trigger inventory_exception_events_append_only before update or delete or truncate on public.inventory_exception_events for each statement execute function app_private.reject_inventory_v2_append_only_mutation();
create trigger manual_refund_events_append_only before update or delete or truncate on public.manual_refund_events for each statement execute function app_private.reject_inventory_v2_append_only_mutation();
create trigger manual_refund_disbursements_append_only before update or delete or truncate on public.manual_refund_disbursements for each statement execute function app_private.reject_inventory_v2_append_only_mutation();
create trigger shipping_fee_refund_disbursements_append_only before update or delete or truncate on public.shipping_fee_refund_disbursements for each statement execute function app_private.reject_inventory_v2_append_only_mutation();
create trigger shipping_fee_refund_events_append_only before update or delete or truncate on public.shipping_fee_refund_events for each statement execute function app_private.reject_inventory_v2_append_only_mutation();
create trigger store_financial_entries_append_only before update or delete or truncate on public.store_financial_entries for each statement execute function app_private.reject_inventory_v2_append_only_mutation();

create or replace function app_private.has_center_permission(
  p_fulfillment_center_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_owner()
    or exists (
      select 1
      from public.fulfillment_center_staff_assignments a
      join public.fulfillment_centers c
        on c.id = a.fulfillment_center_id
       and c.business_id = a.business_id
       and c.status = 'active'
      where a.fulfillment_center_id = p_fulfillment_center_id
        and a.user_id = auth.uid()
        and a.status = 'active'
        and case lower(btrim(coalesce(p_permission, '')))
          when 'receive_at_center' then a.receive_at_center
            and public.has_business_permission(a.business_id, 'receive_at_center')
          when 'create_shipments' then a.create_shipments
            and public.has_business_permission(a.business_id, 'create_shipments')
          else false
        end
    ),
    false
  );
$$;

create or replace function app_private.can_confirm_shared_payment(
  p_business_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_owner()
    or public.has_business_permission(p_business_id, 'confirm_payments')
    or exists (
      select 1
      from public.fulfillment_center_staff_assignments assignments
      join public.fulfillment_centers centers
        on centers.id = assignments.fulfillment_center_id
       and centers.business_id = assignments.business_id
       and centers.status = 'active'
      where assignments.business_id = p_business_id
        and assignments.user_id = auth.uid()
        and assignments.status = 'active'
        and (
          (assignments.receive_at_center and public.has_business_permission(p_business_id, 'receive_at_center'))
          or (assignments.create_shipments and public.has_business_permission(p_business_id, 'create_shipments'))
        )
    ),
    false
  );
$$;

create or replace function app_private.guard_inventory_item_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(old.member_id, old.business_id, old.origin_store_id, old.product_id,
      old.source_kind,
      old.commerce_order_item_id, old.manual_transfer_order_id, old.legacy_payment_order_id,
      old.paid_amount, old.currency, old.paid_at, old.storage_class_snapshot,
      old.storage_duration_days,old.work_due_date)
    is distinct from
    row(new.member_id, new.business_id, new.origin_store_id, new.product_id,
      new.source_kind,
      new.commerce_order_item_id, new.manual_transfer_order_id, new.legacy_payment_order_id,
      new.paid_amount, new.currency, new.paid_at, new.storage_class_snapshot,
      new.storage_duration_days,new.work_due_date)
  then
    raise exception using errcode = '55000', message = '결제 시점의 보관 상품 스냅샷은 변경할 수 없습니다.';
  end if;
  if old.fulfillment_center_id is not null and row(old.fulfillment_center_id,old.route_mode,old.route_version) is distinct from row(new.fulfillment_center_id,new.route_mode,new.route_version) then raise exception using errcode='55000',message='확정된 출고 경로 스냅샷은 변경할 수 없습니다.'; end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger customer_inventory_items_guard_snapshot
before update on public.customer_inventory_items
for each row execute function app_private.guard_inventory_item_snapshot();

create or replace function app_private.bump_unified_payment_version()
returns trigger language plpgsql set search_path = '' as $$
begin new.version:=old.version+1; return new; end; $$;
create trigger commerce_order_transfers_bump_unified_version before update on public.commerce_order_transfers for each row execute function app_private.bump_unified_payment_version();
create trigger manual_transfer_orders_bump_unified_version before update on public.manual_transfer_orders for each row execute function app_private.bump_unified_payment_version();
create trigger shipping_fee_payments_bump_unified_version before update on public.shipping_fee_payments for each row execute function app_private.bump_unified_payment_version();

create or replace function app_private.create_customer_inventory_entitlement(
  p_source_kind text,
  p_source_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid;
  v_business uuid;
  v_store uuid;
  v_product uuid;
  v_amount bigint;
  v_paid_at timestamptz;
  v_storage_class text;
  v_closes_at timestamptz;
  v_center uuid;
  v_route_mode text;
  v_route_version bigint;
  v_legacy_storage_expires timestamptz;
  v_legacy_commerce_shipment uuid;
  v_item uuid;
  v_stage text;
  v_location text;
begin
  if p_source_kind = 'commerce' then
    select o.member_id, s.business_id, i.store_id, i.product_id, i.unit_price,
           coalesce(i.paid_at, o.updated_at), p.storage_class, p.closes_at,
           i.storage_expires_at, csi.shipment_id
      into v_member, v_business, v_store, v_product, v_amount, v_paid_at,
           v_storage_class, v_closes_at, v_legacy_storage_expires,
           v_legacy_commerce_shipment
    from public.commerce_order_items i
    join public.commerce_orders o on o.id = i.order_id
    join public.products p on p.id = i.product_id
    join public.stores s on s.id = i.store_id
    left join public.commerce_shipment_items csi on csi.order_item_id = i.id
    where i.id = p_source_id and i.payment_status = 'paid';
  elsif p_source_kind = 'auction' then
    select m.buyer_id, s.business_id, p.store_id, m.product_id, m.expected_amount,
           m.confirmed_at, p.storage_class, p.closes_at
      into v_member, v_business, v_store, v_product, v_amount, v_paid_at, v_storage_class, v_closes_at
    from public.manual_transfer_orders m
    join public.products p on p.id = m.product_id
    join public.stores s on s.id = p.store_id
    where m.id = p_source_id and m.status = 'confirmed' and m.buyer_id is not null;
  elsif p_source_kind = 'legacy_portone' then
    select po.buyer_id, s.business_id, p.store_id, po.product_id, po.expected_amount,
           po.paid_at, p.storage_class, p.closes_at
      into v_member, v_business, v_store, v_product, v_amount, v_paid_at, v_storage_class, v_closes_at
    from public.payment_orders po
    join public.products p on p.id = po.product_id
    join public.stores s on s.id = p.store_id
    where po.id = p_source_id and po.payment_status = '결제완료'
      and po.portone_status = 'PAID' and po.buyer_id is not null;
  else
    raise exception using errcode = '22023', message = '지원하지 않는 결제 원천입니다.';
  end if;

  if v_member is null then return null; end if;
  if not exists(select 1 from public.inventory_fulfillment_rollout_settings where business_id=v_business and entitlement_projection_enabled) then return null; end if;

  if current_setting('app.inventory_entitlement_backfill',true) is distinct from '1' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('inventory-route:' || v_store::text, 0)
    );
    select r.fulfillment_center_id, r.route_mode, r.version into v_center, v_route_mode, v_route_version
    from public.store_fulfillment_routes r join public.fulfillment_centers c on c.id = r.fulfillment_center_id and c.status = 'active'
    where r.store_id = v_store and r.status = 'active'
    for key share of r, c;
  end if;

  insert into public.customer_inventory_items (
    member_id, business_id, origin_store_id, product_id, fulfillment_center_id,
    route_mode, route_version, source_kind, commerce_order_item_id,
    manual_transfer_order_id, legacy_payment_order_id, legacy_commerce_shipment_id,
    paid_amount, paid_at, storage_class_snapshot, storage_duration_days,
    work_due_date, storage_started_at, storage_expires_at
  ) values (
    v_member, v_business, v_store, v_product, v_center, v_route_mode, v_route_version,
    p_source_kind,
    case when p_source_kind = 'commerce' then p_source_id end,
    case when p_source_kind = 'auction' then p_source_id end,
    case when p_source_kind = 'legacy_portone' then p_source_id end,
    v_legacy_commerce_shipment,
    v_amount, coalesce(v_paid_at, clock_timestamp()), v_storage_class,
    case when v_storage_class = 'large' then 7 else 14 end,
    ((greatest(v_closes_at,coalesce(v_paid_at,clock_timestamp())) at time zone 'Asia/Seoul')::date + 1),
    case when current_setting('app.inventory_entitlement_backfill',true) = '1'
      and v_legacy_storage_expires is not null
      then v_legacy_storage_expires - make_interval(days => case when v_storage_class = 'large' then 7 else 14 end)
    end,
    case when current_setting('app.inventory_entitlement_backfill',true) = '1'
      then v_legacy_storage_expires
    end
  ) on conflict do nothing returning id into v_item;

  if v_item is null then
    select id into v_item from public.customer_inventory_items
    where commerce_order_item_id = case when p_source_kind = 'commerce' then p_source_id end
       or manual_transfer_order_id = case when p_source_kind = 'auction' then p_source_id end
       or legacy_payment_order_id = case when p_source_kind = 'legacy_portone' then p_source_id end;
    return v_item;
  end if;

  v_stage := case when v_center is null then 'reconciliation_required' else 'entitled' end;
  v_location := case when v_center is null then 'unknown' else 'store' end;
  insert into public.inventory_item_fulfillments (
    inventory_item_id, business_id, origin_store_id, fulfillment_center_id,
    route_mode, current_stage, location_kind
  ) values (v_item, v_business, v_store, v_center, v_route_mode, v_stage, v_location);

  insert into public.inventory_item_fulfillment_events (
    inventory_item_id, sequence_no, event_type, to_stage, to_location_kind,
    actor_kind, idempotency_key, reason_code
  ) values (v_item, 1,
    case when v_center is null then 'reconciliation_required' else 'entitled' end,
    v_stage, v_location, 'system', gen_random_uuid(),
    case when v_center is null then 'fulfillment_route_unresolved' end);

  insert into public.store_financial_entries (
    business_id, origin_store_id, inventory_item_id, entry_kind, amount,
    occurred_at, idempotency_key, metadata
  ) values (v_business, v_store, v_item, 'item_payment', v_amount,
    coalesce(v_paid_at, clock_timestamp()), gen_random_uuid(),
    jsonb_build_object('sourceKind', p_source_kind, 'sourceId', p_source_id));
  return v_item;
end;
$$;

create or replace function app_private.link_legacy_commerce_shipment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.customer_inventory_items
  set legacy_commerce_shipment_id = new.shipment_id,
      version = version + 1
  where commerce_order_item_id = new.order_item_id
    and legacy_commerce_shipment_id is null;
  return new;
end;
$$;

create trigger commerce_shipment_items_link_unified_inventory
after insert on public.commerce_shipment_items
for each row execute function app_private.link_legacy_commerce_shipment();

create or replace function app_private.guard_legacy_commerce_shipment_rollout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.inventory_fulfillment_rollout_settings settings
    where settings.business_id = new.business_id
      and settings.item_selected_shipments_enabled
  ) then
    raise exception using
      errcode = '55000',
      message = '선택 상품 배송이 활성화되어 기존 주문 단위 배송을 만들 수 없습니다.';
  end if;
  return new;
end;
$$;

create trigger commerce_shipment_orders_guard_inventory_v2_rollout
before insert on public.commerce_shipment_orders
for each row execute function app_private.guard_legacy_commerce_shipment_rollout();

create or replace function public.get_legacy_commerce_shipment_quote(
  p_member_id uuid,
  p_order_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_business_count integer;
  v_fee_amount bigint;
  v_bank_name text;
  v_account_number text;
begin
  if coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  ) is distinct from 'service_role' then
    raise exception using errcode = '42501', message = '서버 배송 견적 경계가 필요합니다.';
  end if;
  if p_member_id is null or p_order_id is null then
    raise exception using errcode = '22023', message = '배송 견적 대상을 확인해 주세요.';
  end if;
  select min(stores.business_id::text)::uuid, count(distinct stores.business_id)::integer
  into v_business_id, v_business_count
  from public.commerce_orders orders
  join public.commerce_order_items items on items.order_id = orders.id
  join public.stores stores on stores.id = items.store_id
  where orders.id = p_order_id and orders.member_id = p_member_id;
  if v_business_count <> 1 then
    raise exception using errcode = 'P0002', message = '배송 견적 주문을 찾을 수 없습니다.';
  end if;
  select settings.shipping_fee_amount
  into v_fee_amount
  from public.inventory_fulfillment_rollout_settings settings
  where settings.business_id = v_business_id
    and not settings.item_selected_shipments_enabled;
  select settings.bank_name, settings.account_number
  into v_bank_name, v_account_number
  from public.payment_runtime_settings settings
  where settings.singleton and settings.active_mode = 'manual_transfer';
  if v_fee_amount is null
    or nullif(btrim(coalesce(v_bank_name, '')), '') is null
    or nullif(btrim(coalesce(v_account_number, '')), '') is null
  then
    raise exception using errcode = '55000', message = '현재 기존 주문 배송비 또는 입금 계좌를 사용할 수 없습니다.';
  end if;
  return jsonb_build_object(
    'expected_amount', v_fee_amount,
    'bank_name_snapshot', btrim(v_bank_name),
    'account_number_snapshot', btrim(v_account_number)
  );
end;
$$;

create or replace function app_private.guard_legacy_commerce_shipment_runtime()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.shipping_fee_payments%rowtype;
  v_fee_amount bigint;
  v_bank_name text;
  v_account_number text;
begin
  if exists (
    select 1 from public.inventory_fulfillment_rollout_settings settings
    where settings.business_id = new.business_id
      and settings.item_selected_shipments_enabled
  ) then
    raise exception using errcode = '55000', message = '선택 상품 배송이 활성화되어 기존 주문 단위 배송을 만들 수 없습니다.';
  end if;
  if new.settlement_method = 'manual_transfer' then
    select * into v_payment from public.shipping_fee_payments where id = new.shipping_fee_payment_id;
    select settings.shipping_fee_amount into v_fee_amount
    from public.inventory_fulfillment_rollout_settings settings
    where settings.business_id = new.business_id;
    select settings.bank_name, settings.account_number into v_bank_name, v_account_number
    from public.payment_runtime_settings settings
    where settings.singleton and settings.active_mode = 'manual_transfer';
    if v_payment.id is null
      or v_payment.expected_amount is distinct from v_fee_amount
      or btrim(coalesce(v_payment.bank_name_snapshot, '')) is distinct from btrim(coalesce(v_bank_name, ''))
      or btrim(coalesce(v_payment.account_number_snapshot, '')) is distinct from btrim(coalesce(v_account_number, ''))
    then
      raise exception using errcode = 'PT409', message = '배송비 또는 입금 계좌가 변경되었습니다. 다시 요청해 주세요.';
    end if;
  end if;
  return new;
end;
$$;

create trigger commerce_shipments_guard_inventory_v2_runtime
before insert on public.commerce_shipments
for each row execute function app_private.guard_legacy_commerce_shipment_runtime();

create or replace function app_private.project_inventory_entitlement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- NEW has the trigger relation's row type. Keep the relation branches
  -- separate so PL/pgSQL never evaluates a missing column on another source.
  if tg_table_name = 'commerce_order_items' then
    if new.payment_status = 'paid' then
      perform app_private.create_customer_inventory_entitlement('commerce', new.id);
    end if;
  elsif tg_table_name = 'manual_transfer_orders' then
    if new.status = 'confirmed' then
      perform app_private.create_customer_inventory_entitlement('auction', new.id);
    end if;
  elsif tg_table_name = 'payment_orders' then
    if new.payment_status = '결제완료' and new.portone_status = 'PAID' then
      perform app_private.create_customer_inventory_entitlement('legacy_portone', new.id);
    end if;
  end if;
  return new;
end;
$$;

create trigger commerce_order_items_project_inventory after insert or update of payment_status on public.commerce_order_items for each row execute function app_private.project_inventory_entitlement();
create trigger manual_transfer_orders_project_inventory after insert or update of status on public.manual_transfer_orders for each row execute function app_private.project_inventory_entitlement();
create trigger payment_orders_project_inventory after insert or update of payment_status, portone_status on public.payment_orders for each row execute function app_private.project_inventory_entitlement();

create or replace function app_private.reject_portone_after_manual_settlement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.payment_status = '결제완료'
    and new.portone_status = 'PAID'
    and exists (
      select 1 from public.manual_transfer_orders m
      where m.product_id = new.product_id and m.status = 'confirmed'
    )
  then
    raise exception using errcode='55000',message='수동 입금이 이미 확정된 상품은 PortOne 결제로 중복 확정할 수 없습니다.';
  end if;
  return new;
end;
$$;

create trigger payment_orders_reject_manual_transfer_double_settlement
before insert or update of payment_status, portone_status on public.payment_orders
for each row execute function app_private.reject_portone_after_manual_settlement();

select app_private.create_customer_inventory_entitlement('commerce', id)
from public.commerce_order_items where payment_status = 'paid';
select app_private.create_customer_inventory_entitlement('auction', id)
from public.manual_transfer_orders where status = 'confirmed';
select app_private.create_customer_inventory_entitlement('legacy_portone', id)
from public.payment_orders where payment_status = '결제완료' and portone_status = 'PAID';

-- Owner routing and the shared payment queue -------------------------------

create or replace function public.configure_store_fulfillment_route(
  p_store_id uuid,
  p_fulfillment_center_id uuid,
  p_route_mode text,
  p_expected_version bigint,
  p_idempotency_key uuid,
  p_reason text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_route public.store_fulfillment_routes%rowtype;
  v_before jsonb; v_replay public.store_fulfillment_route_events%rowtype;
begin
  if v_actor is null or not public.is_owner() then raise exception using errcode='42501', message='Owner 권한이 필요합니다.'; end if;
  if p_route_mode not in ('transfer','co_located') or p_idempotency_key is null then raise exception using errcode='22023', message='출고 경로 입력값을 확인해 주세요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('inventory-route:'||p_store_id::text,0));
  select * into v_replay from public.store_fulfillment_route_events where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
  if found then
    if (v_replay.to_snapshot->>'storeId')::uuid is distinct from p_store_id
      or (v_replay.to_snapshot->>'centerId')::uuid is distinct from p_fulfillment_center_id
      or v_replay.to_snapshot->>'routeMode' is distinct from p_route_mode then
      raise exception using errcode='23505', message='동일한 요청 키를 다른 경로 설정에 재사용할 수 없습니다.';
    end if;
    return v_replay.to_snapshot || jsonb_build_object('idempotent_replay',true);
  end if;
  perform 1 from public.fulfillment_centers c join public.stores s on s.business_id=c.business_id
   where s.id=p_store_id and c.id=p_fulfillment_center_id and c.status='active';
  if not found then raise exception using errcode='23514', message='같은 사업자의 활성 출고 센터를 선택해 주세요.'; end if;
  select * into v_route from public.store_fulfillment_routes where store_id=p_store_id for update;
  if found then
    if v_route.version is distinct from p_expected_version then raise exception using errcode='PT409', message='경로가 변경되었습니다. 새로고침 후 다시 시도해 주세요.'; end if;
    v_before := jsonb_build_object('id',v_route.id,'storeId',v_route.store_id,'centerId',v_route.fulfillment_center_id,'routeMode',v_route.route_mode,'status',v_route.status,'version',v_route.version);
    update public.store_fulfillment_routes set fulfillment_center_id=p_fulfillment_center_id, route_mode=p_route_mode,
      status='active', version=version+1, updated_by=v_actor, updated_at=clock_timestamp()
    where id=v_route.id returning * into v_route;
  else
    if p_expected_version is not null and p_expected_version <> 0 then raise exception using errcode='PT409', message='새 경로의 예상 버전은 0이어야 합니다.'; end if;
    insert into public.store_fulfillment_routes(business_id,store_id,fulfillment_center_id,route_mode,created_by,updated_by)
    select s.business_id,s.id,p_fulfillment_center_id,p_route_mode,v_actor,v_actor from public.stores s where s.id=p_store_id returning * into v_route;
  end if;
  insert into public.store_fulfillment_route_events(route_id,sequence_no,event_type,actor_user_id,idempotency_key,reason,from_snapshot,to_snapshot)
  values(v_route.id,coalesce((select max(sequence_no)+1 from public.store_fulfillment_route_events where route_id=v_route.id),1),
    case when v_before is null then 'configured' else 'updated' end,v_actor,p_idempotency_key,nullif(btrim(coalesce(p_reason,'')),''),v_before,
    jsonb_build_object('id',v_route.id,'storeId',v_route.store_id,'centerId',v_route.fulfillment_center_id,'routeMode',v_route.route_mode,'status',v_route.status,'version',v_route.version));
  return jsonb_build_object('id',v_route.id,'storeId',v_route.store_id,'centerId',v_route.fulfillment_center_id,'routeMode',v_route.route_mode,'status',v_route.status,'version',v_route.version,'idempotent_replay',false);
end; $$;

create or replace function public.configure_inventory_fulfillment_rollout(
 p_business_id uuid,p_entitlement_projection_enabled boolean,p_unified_inventory_reads_enabled boolean,p_item_selected_shipments_enabled boolean,p_shipping_fee_amount bigint,p_expected_version bigint,p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_s public.inventory_fulfillment_rollout_settings%rowtype; v_fp text; v_r public.inventory_command_receipts%rowtype; v_result jsonb;
begin
 if v_actor is null or not public.is_owner() then raise exception using errcode='42501',message='Owner 권한이 필요합니다.'; end if;
 if p_idempotency_key is null then raise exception using errcode='22023',message='요청 키가 필요합니다.'; end if;
 if p_shipping_fee_amount not between 1 and 1000000 then raise exception using errcode='22023',message='배송비 설정을 확인해 주세요.'; end if;
 v_fp:=app_private.inventory_v2_fingerprint(jsonb_build_object('business',p_business_id,'projection',p_entitlement_projection_enabled,'reads',p_unified_inventory_reads_enabled,'shipments',p_item_selected_shipments_enabled,'shippingFee',p_shipping_fee_amount,'version',p_expected_version));
 select * into v_r from public.inventory_command_receipts where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
 if found then if v_r.command_name<>'configure_rollout' or v_r.request_fingerprint<>v_fp then raise exception using errcode='23505',message='동일한 요청 키를 재사용할 수 없습니다.'; end if; return v_r.result||jsonb_build_object('idempotent_replay',true); end if;
 select * into v_s from public.inventory_fulfillment_rollout_settings where business_id=p_business_id for update;
 if not found or v_s.version<>p_expected_version then raise exception using errcode='PT409',message='롤아웃 설정이 변경되었습니다.'; end if;
 if p_unified_inventory_reads_enabled and not p_entitlement_projection_enabled then raise exception using errcode='23514',message='통합 보관함 읽기 전에 결제 권리 생성을 활성화해 주세요.'; end if;
 if p_item_selected_shipments_enabled and (not p_entitlement_projection_enabled or not p_unified_inventory_reads_enabled or exists(select 1 from public.stores st left join public.store_fulfillment_routes rt on rt.store_id=st.id and rt.status='active' left join public.fulfillment_centers c on c.id=rt.fulfillment_center_id and c.status='active' where st.business_id=p_business_id and st.is_active and c.id is null)) then raise exception using errcode='23514',message='상품 투영, 모든 활성 매장의 출고 경로, 통합 보관함 읽기를 먼저 활성화해 주세요.'; end if;
 if p_entitlement_projection_enabled and not v_s.entitlement_projection_enabled then
   -- Drain in-flight paid-source writes and block new ones until the flag and
   -- backfill commit together. The fixed relation order is shared by every
   -- rollout activation and avoids the trigger/backfill missed-row window.
   lock table public.commerce_order_items,public.manual_transfer_orders,public.payment_orders
   in share row exclusive mode;
 end if;
 update public.inventory_fulfillment_rollout_settings set entitlement_projection_enabled=p_entitlement_projection_enabled,unified_inventory_reads_enabled=p_unified_inventory_reads_enabled,item_selected_shipments_enabled=p_item_selected_shipments_enabled,shipping_fee_amount=p_shipping_fee_amount,version=version+1,updated_by=v_actor,updated_at=clock_timestamp() where business_id=p_business_id returning * into v_s;
 if p_entitlement_projection_enabled then
   perform set_config('app.inventory_entitlement_backfill','1',true);
   perform app_private.create_customer_inventory_entitlement('commerce',i.id) from public.commerce_order_items i join public.stores s on s.id=i.store_id where s.business_id=p_business_id and i.payment_status='paid';
   perform app_private.create_customer_inventory_entitlement('auction',m.id) from public.manual_transfer_orders m join public.products p on p.id=m.product_id join public.stores s on s.id=p.store_id where s.business_id=p_business_id and m.status='confirmed';
   perform app_private.create_customer_inventory_entitlement('legacy_portone',po.id) from public.payment_orders po join public.products p on p.id=po.product_id join public.stores s on s.id=p.store_id where s.business_id=p_business_id and po.payment_status='결제완료' and po.portone_status='PAID';
   perform set_config('app.inventory_entitlement_backfill','0',true);
 end if;
 if p_item_selected_shipments_enabled and exists(select 1 from public.inventory_item_fulfillments where business_id=p_business_id and current_stage='reconciliation_required') then raise exception using errcode='23514',message='미조정 보관 상품을 모두 경로 조정한 뒤 선택 배송을 활성화해 주세요.'; end if;
 v_result:=jsonb_build_object('id',p_business_id,'version',v_s.version,'status','configured','entitlement_projection_enabled',v_s.entitlement_projection_enabled,'unified_inventory_reads_enabled',v_s.unified_inventory_reads_enabled,'item_selected_shipments_enabled',v_s.item_selected_shipments_enabled,'shipping_fee_amount',v_s.shipping_fee_amount,'idempotent_replay',false);
 insert into public.inventory_command_receipts values(v_actor,p_idempotency_key,'configure_rollout',p_business_id,v_fp,v_result,clock_timestamp()); return v_result;
end; $$;

create or replace function public.configure_fulfillment_center_staff_assignment(
  p_fulfillment_center_id uuid,
  p_user_id uuid,
  p_receive_at_center boolean,
  p_create_shipments boolean,
  p_status text,
  p_expected_version bigint,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_assignment public.fulfillment_center_staff_assignments%rowtype;
  v_business uuid;
  v_fp text;
  v_receipt public.inventory_command_receipts%rowtype;
  v_result jsonb;
begin
  if v_actor is null or not public.is_owner() then
    raise exception using errcode = '42501', message = 'Owner 권한이 필요합니다.';
  end if;
  if p_idempotency_key is null or p_status not in ('active', 'inactive') then
    raise exception using errcode = '22023', message = '센터 담당자 설정값을 확인해 주세요.';
  end if;
  select business_id into v_business
  from public.fulfillment_centers
  where id = p_fulfillment_center_id;
  if v_business is null or not exists (
    select 1 from public.account_access_roles ar
    where ar.user_id = p_user_id
      and ar.role_code in ('owner', 'operator', 'employee')
  ) then
    raise exception using errcode = '23514', message = '유효한 센터와 운영자 계정을 선택해 주세요.';
  end if;
  v_fp := app_private.inventory_v2_fingerprint(jsonb_build_object(
    'center', p_fulfillment_center_id, 'user', p_user_id,
    'receive', p_receive_at_center, 'ship', p_create_shipments,
    'status', p_status, 'version', p_expected_version
  ));
  select * into v_receipt from public.inventory_command_receipts
  where actor_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.command_name <> 'configure_center_assignment'
      or v_receipt.request_fingerprint <> v_fp then
      raise exception using errcode = '23505', message = '동일한 요청 키를 재사용할 수 없습니다.';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay', true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'center-assignment:' || p_fulfillment_center_id::text || ':' || p_user_id::text, 0
  ));
  select * into v_assignment
  from public.fulfillment_center_staff_assignments
  where fulfillment_center_id = p_fulfillment_center_id and user_id = p_user_id
  for update;
  if found then
    if v_assignment.version is distinct from p_expected_version then
      raise exception using errcode = 'PT409', message = '센터 담당자 설정이 변경되었습니다.';
    end if;
    update public.fulfillment_center_staff_assignments
    set receive_at_center = p_receive_at_center,
        create_shipments = p_create_shipments,
        status = p_status,
        version = version + 1,
        updated_by = v_actor,
        updated_at = clock_timestamp()
    where id = v_assignment.id returning * into v_assignment;
  else
    if coalesce(p_expected_version, 0) <> 0 then
      raise exception using errcode = 'PT409', message = '새 센터 담당자 설정의 예상 버전은 0이어야 합니다.';
    end if;
    insert into public.fulfillment_center_staff_assignments (
      business_id, fulfillment_center_id, user_id, status,
      receive_at_center, create_shipments, created_by, updated_by
    ) values (
      v_business, p_fulfillment_center_id, p_user_id, p_status,
      p_receive_at_center, p_create_shipments, v_actor, v_actor
    ) returning * into v_assignment;
  end if;
  v_result := jsonb_build_object(
    'id', v_assignment.id, 'businessId', v_assignment.business_id,
    'centerId', v_assignment.fulfillment_center_id, 'userId', v_assignment.user_id,
    'receiveAtCenter', v_assignment.receive_at_center,
    'createShipments', v_assignment.create_shipments,
    'status', v_assignment.status, 'version', v_assignment.version,
    'idempotent_replay', false
  );
  insert into public.inventory_command_receipts values (
    v_actor, p_idempotency_key, 'configure_center_assignment',
    p_fulfillment_center_id, v_fp, v_result, clock_timestamp()
  );
  return v_result;
end;
$$;

create or replace function public.get_owner_inventory_fulfillment_configuration()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception using errcode = '42501', message = 'Owner 권한이 필요합니다.';
  end if;
  select jsonb_build_object(
    'stores', coalesce((select jsonb_agg(to_jsonb(q) order by q.name,q.id) from (
      select id,business_id,name,slug,description,is_active,updated_at from public.stores
    ) q),'[]'::jsonb),
    'centers', coalesce((select jsonb_agg(to_jsonb(q) order by q.name,q.id) from (
      select id,business_id,code,name,status,is_default,postal_code,address_line1,address_line2,contact_name,contact_phone,version,updated_at from public.fulfillment_centers
    ) q),'[]'::jsonb),
    'routes', coalesce((select jsonb_agg(to_jsonb(q) order by q.updated_at desc,q.id) from (
      select id,business_id,store_id,fulfillment_center_id,route_mode,status,version,updated_at from public.store_fulfillment_routes
    ) q),'[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(to_jsonb(q) order by q.updated_at desc,q.id) from (
      select id,business_id,fulfillment_center_id,user_id,status,receive_at_center,create_shipments,version,updated_at from public.fulfillment_center_staff_assignments
    ) q),'[]'::jsonb),
    'rollouts', coalesce((select jsonb_agg(to_jsonb(q) order by q.updated_at desc,q.business_id) from (
      select business_id,entitlement_projection_enabled,unified_inventory_reads_enabled,item_selected_shipments_enabled,shipping_fee_amount,version,updated_at from public.inventory_fulfillment_rollout_settings
    ) q),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.get_inventory_operational_health()
returns jsonb language sql stable security definer set search_path = '' as $$
select jsonb_build_object('businesses',coalesce(jsonb_agg(jsonb_build_object('businessId',b.id,'businessName',b.name,'reconciliationRequired',(select count(*) from public.inventory_item_fulfillments f where f.business_id=b.id and f.current_stage='reconciliation_required'),'blockedItems',(select count(*) from public.inventory_item_fulfillments f where f.business_id=b.id and f.is_blocked),'overdueItems',(select count(*) from public.customer_inventory_items i join public.inventory_item_fulfillments f on f.inventory_item_id=i.id where i.business_id=b.id and i.work_due_date<(clock_timestamp() at time zone 'Asia/Seoul')::date and f.current_stage not in ('center_stored','packed','shipped','cancelled')),'openExceptions',(select count(*) from public.inventory_exception_cases e where e.business_id=b.id and e.status='open'),'pendingRefunds',(select count(*) from public.manual_refunds r where r.business_id=b.id and r.status in ('requested','approved')),'pendingShippingFees',(select count(*) from public.shipping_fee_payments p where p.business_id=b.id and p.status='awaiting_transfer'),'rollout',jsonb_build_object('projection',s.entitlement_projection_enabled,'reads',s.unified_inventory_reads_enabled,'shipments',s.item_selected_shipments_enabled)) order by b.name,b.id),'[]'::jsonb),'serverTime',clock_timestamp())
from public.businesses b join public.inventory_fulfillment_rollout_settings s on s.business_id=b.id
where public.is_owner() or public.has_business_permission(b.id,'confirm_payments') or public.has_business_permission(b.id,'prepare_orders') or public.has_business_permission(b.id,'receive_at_center') or public.has_business_permission(b.id,'create_shipments') or public.has_business_permission(b.id,'view_reports');
$$;

create or replace function public.get_owner_inventory_reconciliation_queue(
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
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_owner() then
    raise exception using errcode = '42501', message = 'Owner 권한이 필요합니다.';
  end if;
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'inventoryItemId', q.inventory_item_id,
      'productId', q.product_id,
      'title', q.title,
      'imageUrl', q.image_url,
      'businessId', q.business_id,
      'originStoreId', q.origin_store_id,
      'originStoreName', q.origin_store_name,
      'paidAt', q.paid_at,
      'paidAmount', q.paid_amount,
      'fulfillmentVersion', q.fulfillment_version,
      'targetCenterId', q.target_center_id,
      'targetCenterName', q.target_center_name,
      'targetRouteMode', q.target_route_mode,
      'targetRouteVersion', q.target_route_version
    ) order by q.paid_at, q.inventory_item_id), '[]'::jsonb)
  ) into v_result
  from (
    select i.id inventory_item_id, i.product_id, p.title,
      coalesce(p.image_urls[1], '') image_url, i.business_id,
      i.origin_store_id, s.name origin_store_name, i.paid_at, i.paid_amount,
      f.version fulfillment_version, r.fulfillment_center_id target_center_id,
      c.name target_center_name, r.route_mode target_route_mode,
      r.version target_route_version
    from public.customer_inventory_items i
    join public.inventory_item_fulfillments f on f.inventory_item_id = i.id
    join public.products p on p.id = i.product_id
    join public.stores s on s.id = i.origin_store_id
    left join public.store_fulfillment_routes r
      on r.store_id = i.origin_store_id and r.status = 'active'
    left join public.fulfillment_centers c
      on c.id = r.fulfillment_center_id and c.status = 'active'
    where f.current_stage = 'reconciliation_required'
      and i.ownership_status = 'active'
    order by i.paid_at, i.id
    limit greatest(1, least(coalesce(p_limit, 200), 500))
    offset greatest(coalesce(p_offset, 0), 0)
  ) q;
  return coalesce(v_result, jsonb_build_object('items', '[]'::jsonb));
end;
$$;

create or replace function public.reconcile_inventory_item_route(p_inventory_item_id uuid,p_expected_version bigint,p_idempotency_key uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_i public.customer_inventory_items%rowtype; v_f public.inventory_item_fulfillments%rowtype; v_route public.store_fulfillment_routes%rowtype; v_fp text; v_r public.inventory_command_receipts%rowtype; v_result jsonb;
begin
 if v_actor is null or not public.is_owner() then raise exception using errcode='42501',message='Owner 권한이 필요합니다.'; end if;
 if p_idempotency_key is null or char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception using errcode='22023',message='경로 조정 사유를 입력해 주세요.'; end if;
 v_fp:=app_private.inventory_v2_fingerprint(jsonb_build_object('item',p_inventory_item_id,'version',p_expected_version,'reason',btrim(p_reason))); select * into v_r from public.inventory_command_receipts where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
 if found then if v_r.command_name<>'reconcile_inventory_item' or v_r.request_fingerprint<>v_fp then raise exception using errcode='23505',message='동일한 요청 키를 재사용할 수 없습니다.'; end if; return v_r.result||jsonb_build_object('idempotent_replay',true); end if;
 select * into v_i from public.customer_inventory_items where id=p_inventory_item_id for update; select * into v_f from public.inventory_item_fulfillments where inventory_item_id=p_inventory_item_id for update;
 if not found or v_f.current_stage<>'reconciliation_required' or v_f.version<>p_expected_version then raise exception using errcode='PT409',message='조정 대상 상태가 변경되었습니다.'; end if;
 select r.* into v_route from public.store_fulfillment_routes r join public.fulfillment_centers c on c.id=r.fulfillment_center_id and c.status='active' where r.store_id=v_i.origin_store_id and r.status='active';
 if not found then raise exception using errcode='23514',message='활성 출고 경로가 없습니다.'; end if;
 update public.customer_inventory_items set fulfillment_center_id=v_route.fulfillment_center_id,route_mode=v_route.route_mode,route_version=v_route.version,version=version+1 where id=v_i.id;
 update public.inventory_item_fulfillments set fulfillment_center_id=v_route.fulfillment_center_id,route_mode=v_route.route_mode,current_stage='preparing',location_kind='store',version=version+1,last_event_at=clock_timestamp(),updated_at=clock_timestamp() where inventory_item_id=v_i.id returning * into v_f;
 insert into public.inventory_item_fulfillment_events(inventory_item_id,sequence_no,event_type,from_stage,to_stage,from_location_kind,to_location_kind,actor_kind,actor_user_id,idempotency_key,reason_code,note) values(v_i.id,coalesce((select max(sequence_no)+1 from public.inventory_item_fulfillment_events where inventory_item_id=v_i.id),1),'entitled','reconciliation_required','preparing','unknown','store','user',v_actor,p_idempotency_key,'route_reconciled',p_reason);
 v_result:=jsonb_build_object('id',v_i.id,'version',v_f.version,'status',v_f.current_stage,'idempotent_replay',false); insert into public.inventory_command_receipts values(v_actor,p_idempotency_key,'reconcile_inventory_item',v_i.id,v_fp,v_result,clock_timestamp()); return v_result;
end; $$;

create or replace function public.get_inventory_shipment_queue(p_include_shipped boolean default false,p_limit integer default 100,p_offset integer default 0)
returns jsonb language sql stable security definer set search_path = '' as $$
select jsonb_build_object('shipments',coalesce(jsonb_agg(jsonb_build_object(
 'id',sh.id,'memberId',sh.member_id,'businessId',sh.business_id,'centerId',sh.fulfillment_center_id,'status',sh.status,'version',sh.version,'settlementMethod',sh.settlement_method,
 'shippingFeeStatus',case when sh.settlement_method='manual_transfer' then fp.status else 'confirmed' end,'requestedAt',sh.created_at,'packedAt',sh.packed_at,'shippedAt',sh.shipped_at,'courier',sh.courier,'trackingNumber',sh.tracking_number,'addressSnapshot',sh.address_snapshot,
 'itemCount',(select count(*) from public.inventory_shipment_items x where x.shipment_id=sh.id),
 'activeItemCount',(select count(*) from public.inventory_shipment_items x where x.shipment_id=sh.id and x.line_status not in ('excluded','cancelled')),
 'storedItemCount',(select count(*) from public.inventory_shipment_items x join public.inventory_item_fulfillments f on f.inventory_item_id=x.inventory_item_id where x.shipment_id=sh.id and f.current_stage='center_stored'),
 'heldItemCount',(select count(*) from public.inventory_shipment_items x where x.shipment_id=sh.id and x.line_status='held'),
 'storeWorks',(select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'storeId',w.origin_store_id,'storeName',s.name,'status',w.status,'version',w.version) order by w.origin_store_id),'[]'::jsonb) from public.inventory_shipment_store_works w join public.stores s on s.id=w.origin_store_id where w.shipment_id=sh.id),
 'items',(select coalesce(jsonb_agg(jsonb_build_object('inventoryItemId',x.inventory_item_id,'productId',x.product_id,'title',p.title,'imageUrl',coalesce(p.image_urls[1],''),'lineStatus',x.line_status,'physicalStatus',f.current_stage,'originStoreName',s.name,'isBlocked',f.is_blocked) order by x.inventory_item_id),'[]'::jsonb) from public.inventory_shipment_items x join public.products p on p.id=x.product_id join public.inventory_item_fulfillments f on f.inventory_item_id=x.inventory_item_id join public.stores s on s.id=x.origin_store_id where x.shipment_id=sh.id)
) order by sh.created_at,sh.id),'[]'::jsonb))
from (select sh.* from public.inventory_shipments sh where (p_include_shipped or sh.status<>'shipped') and app_private.has_center_permission(sh.fulfillment_center_id,'create_shipments') order by sh.created_at,sh.id limit greatest(1,least(coalesce(p_limit,100),500)) offset greatest(coalesce(p_offset,0),0)) sh
left join public.shipping_fee_payments fp on fp.id=sh.shipping_fee_payment_id;
$$;

create or replace function public.pack_inventory_shipment(p_shipment_id uuid,p_expected_version bigint,p_idempotency_key uuid,p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_sh public.inventory_shipments%rowtype; v_fp text; v_r public.inventory_command_receipts%rowtype; v_result jsonb; v_blocked jsonb;
begin
 if v_actor is null or p_idempotency_key is null then raise exception using errcode='42501',message='출고 권한이 필요합니다.'; end if;
 v_fp:=app_private.inventory_v2_fingerprint(jsonb_build_object('shipment',p_shipment_id,'version',p_expected_version,'note',btrim(coalesce(p_note,''))));
 select * into v_r from public.inventory_command_receipts where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
 if found then if v_r.command_name<>'pack_shipment' or v_r.request_fingerprint<>v_fp then raise exception using errcode='23505',message='동일한 요청 키를 재사용할 수 없습니다.'; end if; return v_r.result||jsonb_build_object('idempotent_replay',true); end if;
 perform app_private.lock_inventory_shipment(p_shipment_id);
 select * into v_sh from public.inventory_shipments where id=p_shipment_id for update;
 if not found then raise exception using errcode='P0002',message='배송 신청을 찾지 못했습니다.'; end if;
 if not app_private.has_center_permission(v_sh.fulfillment_center_id,'create_shipments') then raise exception using errcode='42501',message='택배 발송을 처리할 권한이 없습니다.'; end if;
 if v_sh.version<>p_expected_version then raise exception using errcode='PT409',message='배송 상태가 변경되었습니다.'; end if;
  perform 1 from public.inventory_item_fulfillments f join public.inventory_shipment_items x on x.inventory_item_id=f.inventory_item_id where x.shipment_id=v_sh.id order by f.inventory_item_id for update of f,x;
 select coalesce(jsonb_agg(inventory_item_id order by inventory_item_id),'[]'::jsonb) into v_blocked from (select distinct x.inventory_item_id from public.inventory_shipment_items x join public.inventory_item_fulfillments f on f.inventory_item_id=x.inventory_item_id where x.shipment_id=v_sh.id and x.line_status not in ('excluded','cancelled') and (x.line_status<>'ready' or f.current_stage<>'center_stored' or not f.outbound_released or f.is_blocked or exists(select 1 from public.inventory_exception_cases e where e.inventory_item_id=x.inventory_item_id and e.status='open') or exists(select 1 from public.inventory_shipment_store_works w where w.shipment_id=x.shipment_id and w.origin_store_id=x.origin_store_id and w.status<>'outbound_complete')))blocked;
 if v_sh.status<>'ready_to_pack'
   or (v_sh.settlement_method='manual_transfer' and not exists(select 1 from public.shipping_fee_payments where id=v_sh.shipping_fee_payment_id and status='confirmed'))
   or not exists(select 1 from public.inventory_shipment_items where shipment_id=v_sh.id and line_status not in ('excluded','cancelled'))
   or jsonb_array_length(v_blocked)>0
   or exists(select 1 from public.inventory_shipment_store_works where shipment_id=v_sh.id and status<>'outbound_complete') then
   raise exception using errcode='55000',message='미 출고된 상품이 존재합니다',detail=jsonb_build_object('code','UNRELEASED_ITEMS','blockedItemIds',v_blocked)::text;
 end if;
 update public.inventory_shipment_items set line_status='packed',updated_at=clock_timestamp() where shipment_id=v_sh.id and line_status='ready';
 update public.inventory_item_fulfillments f set current_stage='packed',storage_location_code=null,version=version+1,last_event_at=clock_timestamp(),updated_at=clock_timestamp() from public.inventory_shipment_items x where x.shipment_id=v_sh.id and x.inventory_item_id=f.inventory_item_id and x.line_status='packed';
 update public.inventory_shipments set status='packed',packed_at=clock_timestamp(),packed_by=v_actor,version=version+1,updated_at=clock_timestamp() where id=v_sh.id returning * into v_sh;
 insert into public.inventory_shipment_events(shipment_id,sequence_no,event_type,from_status,to_status,actor_kind,actor_user_id,idempotency_key,reason) values(v_sh.id,coalesce((select max(sequence_no)+1 from public.inventory_shipment_events where shipment_id=v_sh.id),1),'packed','ready_to_pack','packed','user',v_actor,p_idempotency_key,p_note);
 v_result:=jsonb_build_object('id',v_sh.id,'version',v_sh.version,'status',v_sh.status,'idempotent_replay',false); insert into public.inventory_command_receipts values(v_actor,p_idempotency_key,'pack_shipment',v_sh.id,v_fp,v_result,clock_timestamp()); return v_result;
end; $$;

create or replace function public.ship_inventory_shipment(p_shipment_id uuid,p_expected_version bigint,p_courier text,p_tracking_number text,p_idempotency_key uuid,p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_sh public.inventory_shipments%rowtype; v_fp text; v_r public.inventory_command_receipts%rowtype; v_result jsonb;
begin
 if v_actor is null or p_idempotency_key is null or char_length(btrim(coalesce(p_courier,''))) not between 1 and 80 or char_length(btrim(coalesce(p_tracking_number,''))) not between 3 and 120 then raise exception using errcode='22023',message='택배사와 송장번호를 확인해 주세요.'; end if;
 v_fp:=app_private.inventory_v2_fingerprint(jsonb_build_object('shipment',p_shipment_id,'version',p_expected_version,'courier',btrim(p_courier),'tracking',btrim(p_tracking_number),'note',btrim(coalesce(p_note,''))));
 select * into v_r from public.inventory_command_receipts where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
 if found then if v_r.command_name<>'ship_shipment' or v_r.request_fingerprint<>v_fp then raise exception using errcode='23505',message='동일한 요청 키를 재사용할 수 없습니다.'; end if; return v_r.result||jsonb_build_object('idempotent_replay',true); end if;
 perform app_private.lock_inventory_shipment(p_shipment_id);
 select * into v_sh from public.inventory_shipments where id=p_shipment_id for update;
 if not found then raise exception using errcode='P0002',message='배송 신청을 찾지 못했습니다.'; end if;
 if not app_private.has_center_permission(v_sh.fulfillment_center_id,'create_shipments') then raise exception using errcode='42501',message='택배 발송을 처리할 권한이 없습니다.'; end if;
 if v_sh.version<>p_expected_version or v_sh.status<>'packed' then raise exception using errcode='PT409',message='포장 상태가 변경되었습니다.'; end if;
 if exists(
   select 1
   from public.inventory_shipment_items x
   join public.inventory_item_fulfillments f on f.inventory_item_id=x.inventory_item_id
   where x.shipment_id=v_sh.id and x.line_status='packed'
     and (f.is_blocked or exists(select 1 from public.inventory_exception_cases e where e.inventory_item_id=x.inventory_item_id and e.status='open'))
 ) then raise exception using errcode='55000',message='미 출고된 상품이 존재합니다'; end if;
 update public.inventory_shipment_items set line_status='shipped',updated_at=clock_timestamp() where shipment_id=v_sh.id and line_status='packed';
 update public.inventory_item_fulfillments f set current_stage='shipped',location_kind='transit',version=version+1,last_event_at=clock_timestamp(),updated_at=clock_timestamp() from public.inventory_shipment_items x where x.shipment_id=v_sh.id and x.inventory_item_id=f.inventory_item_id and x.line_status='shipped';
 update public.inventory_shipments set status='shipped',courier=btrim(p_courier),tracking_number=btrim(p_tracking_number),shipped_at=clock_timestamp(),shipped_by=v_actor,version=version+1,updated_at=clock_timestamp() where id=v_sh.id returning * into v_sh;
 insert into public.shipping_fee_waiver_entitlements(member_id,business_id,exception_case_id)
 select i.member_id,i.business_id,e.id
 from public.inventory_exception_cases e
 join public.customer_inventory_items i on i.id=e.inventory_item_id
 where e.shipment_id=v_sh.id and e.status='resolved' and e.resolution='exclude_for_later'
 on conflict(exception_case_id) do nothing;
 insert into public.inventory_shipment_events(shipment_id,sequence_no,event_type,from_status,to_status,actor_kind,actor_user_id,idempotency_key,reason) values(v_sh.id,coalesce((select max(sequence_no)+1 from public.inventory_shipment_events where shipment_id=v_sh.id),1),'shipped','packed','shipped','user',v_actor,p_idempotency_key,p_note);
 v_result:=jsonb_build_object('id',v_sh.id,'version',v_sh.version,'status',v_sh.status,'idempotent_replay',false); insert into public.inventory_command_receipts values(v_actor,p_idempotency_key,'ship_shipment',v_sh.id,v_fp,v_result,clock_timestamp()); return v_result;
end; $$;

create or replace function public.get_my_inventory_shipments()
returns jsonb language sql stable security definer set search_path = '' as $$
with v2 as (
 select sh.created_at requested_at,jsonb_build_object(
  'id',sh.id,'sourceKind','inventory_v2','sourceId',sh.id,'status',sh.status,'settlementMethod',sh.settlement_method,
  'shippingFeeStatus',case when sh.settlement_method='manual_transfer' then fp.status else 'confirmed' end,
  'itemCount',(select count(*) from public.inventory_shipment_items where shipment_id=sh.id),
  'activeItemCount',(select count(*) from public.inventory_shipment_items where shipment_id=sh.id and line_status not in ('excluded','cancelled')),
  'courier',sh.courier,'trackingNumber',sh.tracking_number,
  'trackingUrl',case when lower(coalesce(sh.courier,'')) like '%cj%' and sh.tracking_number ~ '^[0-9-]+$' then 'https://trace.cjlogistics.com/next/tracking.html?wblNo='||sh.tracking_number end,
  'requestedAt',sh.created_at,'packedAt',sh.packed_at,'shippedAt',sh.shipped_at,'addressSnapshot',sh.address_snapshot,
  'items',(select coalesce(jsonb_agg(jsonb_build_object('inventoryItemId',x.inventory_item_id,'productId',x.product_id,'title',p.title,'imageUrl',coalesce(p.image_urls[1],''),'lineStatus',x.line_status,'physicalStatus',f.current_stage) order by x.inventory_item_id),'[]'::jsonb) from public.inventory_shipment_items x join public.products p on p.id=x.product_id join public.inventory_item_fulfillments f on f.inventory_item_id=x.inventory_item_id where x.shipment_id=sh.id)
 ) payload
 from public.inventory_shipments sh left join public.shipping_fee_payments fp on fp.id=sh.shipping_fee_payment_id
 where sh.member_id=auth.uid() and exists(select 1 from public.inventory_fulfillment_rollout_settings rs where rs.business_id=sh.business_id and rs.unified_inventory_reads_enabled)
), legacy as (
 select sh.created_at requested_at,jsonb_build_object(
  'id',sh.id,'sourceKind','canonical_commerce','sourceId',sh.id,'status',sh.status,'settlementMethod',sh.settlement_method,
  'shippingFeeStatus',case when sh.settlement_method='manual_transfer' then fp.status else 'confirmed' end,
  'itemCount',(select count(*) from public.commerce_shipment_items where shipment_id=sh.id),
  'activeItemCount',(select count(*) from public.commerce_shipment_items where shipment_id=sh.id),
  'courier',sh.courier,'trackingNumber',sh.tracking_number,
  'trackingUrl',case when lower(coalesce(sh.courier,'')) like '%cj%' and sh.tracking_number ~ '^[0-9-]+$' then 'https://trace.cjlogistics.com/next/tracking.html?wblNo='||sh.tracking_number end,
  'requestedAt',sh.created_at,'packedAt',sh.packed_at,'shippedAt',sh.shipped_at,'addressSnapshot',sh.address_snapshot,
  'items',(select coalesce(jsonb_agg(jsonb_build_object('inventoryItemId',ci.id,'productId',x.product_id,'title',p.title,'imageUrl',coalesce(p.image_urls[1],''),'lineStatus',case sh.status when 'shipped' then 'shipped' when 'packed' then 'packed' when 'cancelled' then 'cancelled' else 'requested' end,'physicalStatus',case sh.status when 'shipped' then 'shipped' when 'packed' then 'packed' when 'cancelled' then 'cancelled' else 'legacy_in_progress' end) order by x.order_item_id),'[]'::jsonb) from public.commerce_shipment_items x join public.products p on p.id=x.product_id left join public.customer_inventory_items ci on ci.commerce_order_item_id=x.order_item_id where x.shipment_id=sh.id)
 ) payload
 from public.commerce_shipments sh left join public.shipping_fee_payments fp on fp.id=sh.shipping_fee_payment_id
 where sh.member_id=auth.uid()
)
select jsonb_build_object('shipments',coalesce(jsonb_agg(payload order by requested_at desc),'[]'::jsonb)) from (select * from v2 union all select * from legacy) all_shipments;
$$;

create or replace function public.get_inventory_store_work_queue(p_limit integer default 100,p_offset integer default 0)
returns jsonb language sql stable security definer set search_path = '' as $$
select jsonb_build_object('works',coalesce(jsonb_agg(jsonb_build_object(
 'id',w.id,'shipmentId',w.shipment_id,'storeId',w.origin_store_id,'storeName',s.name,'businessId',w.business_id,
 'centerId',w.fulfillment_center_id,'centerName',c.name,'status',w.status,'version',w.version,'requestedAt',w.created_at,
 'itemCount',(select count(*) from public.inventory_shipment_items x where x.shipment_id=w.shipment_id and x.origin_store_id=w.origin_store_id),
 'readyCount',(select count(*) from public.inventory_shipment_items x where x.shipment_id=w.shipment_id and x.origin_store_id=w.origin_store_id and x.line_status='ready'),
 'heldCount',(select count(*) from public.inventory_shipment_items x where x.shipment_id=w.shipment_id and x.origin_store_id=w.origin_store_id and x.line_status='held'),
 'items',(select coalesce(jsonb_agg(jsonb_build_object('inventoryItemId',x.inventory_item_id,'productId',x.product_id,'title',p.title,'imageUrl',coalesce(p.image_urls[1],''),'lineStatus',x.line_status,'physicalStatus',f.current_stage,'fulfillmentVersion',f.version,'isBlocked',f.is_blocked) order by x.inventory_item_id),'[]'::jsonb) from public.inventory_shipment_items x join public.products p on p.id=x.product_id join public.inventory_item_fulfillments f on f.inventory_item_id=x.inventory_item_id where x.shipment_id=w.shipment_id and x.origin_store_id=w.origin_store_id)
) order by w.created_at,w.id),'[]'::jsonb)) from (
 select * from public.inventory_shipment_store_works w where auth.uid() is not null and (public.is_owner() or public.has_store_permission(w.origin_store_id,'prepare_orders')) order by w.created_at,w.id limit greatest(1,least(coalesce(p_limit,100),500)) offset greatest(coalesce(p_offset,0),0)
) w join public.stores s on s.id=w.origin_store_id join public.fulfillment_centers c on c.id=w.fulfillment_center_id;
$$;

create or replace function public.release_inventory_shipment_items(
 p_work_id uuid,p_inventory_item_ids uuid[],p_expected_work_version bigint,p_idempotency_key uuid,p_note text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_work public.inventory_shipment_store_works%rowtype; v_fp text; v_r public.inventory_command_receipts%rowtype; v_result jsonb;
begin
 if v_actor is null then raise exception using errcode='42501',message='로그인이 필요합니다.'; end if;
 if p_idempotency_key is null or coalesce(cardinality(p_inventory_item_ids),0)=0 or cardinality(p_inventory_item_ids)<>cardinality(array(select distinct x from unnest(p_inventory_item_ids)x)) then raise exception using errcode='22023',message='출고 상품 입력값을 확인해 주세요.'; end if;
 v_fp:=app_private.inventory_v2_fingerprint(jsonb_build_object('work',p_work_id,'items',(select jsonb_agg(x order by x) from unnest(p_inventory_item_ids)x),'version',p_expected_work_version,'note',btrim(coalesce(p_note,''))));
 select * into v_r from public.inventory_command_receipts where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
 if found then if v_r.command_name<>'release_store_items' or v_r.request_fingerprint<>v_fp then raise exception using errcode='23505',message='동일한 요청 키를 재사용할 수 없습니다.'; end if; return v_r.result||jsonb_build_object('idempotent_replay',true); end if;
 select * into v_work from public.inventory_shipment_store_works where id=p_work_id for update;
 if not found then raise exception using errcode='P0002',message='매장 출고 작업을 찾지 못했습니다.'; end if;
 perform app_private.lock_inventory_shipment(v_work.shipment_id);
 if not public.is_owner() and not public.has_store_permission(v_work.origin_store_id,'prepare_orders') then raise exception using errcode='42501',message='이 매장의 출고를 처리할 권한이 없습니다.'; end if;
 if v_work.status<>'collecting' or v_work.version<>p_expected_work_version then raise exception using errcode='PT409',message='출고 작업 상태가 변경되었습니다.'; end if;
 perform 1 from public.inventory_item_fulfillments f join public.inventory_shipment_items x on x.inventory_item_id=f.inventory_item_id and x.shipment_id=v_work.shipment_id and x.origin_store_id=v_work.origin_store_id where x.inventory_item_id=any(p_inventory_item_ids) order by f.inventory_item_id for update of f,x;
 if (select count(*) from public.inventory_shipment_items x where x.shipment_id=v_work.shipment_id and x.origin_store_id=v_work.origin_store_id and x.inventory_item_id=any(p_inventory_item_ids) and x.line_status='requested')<>cardinality(p_inventory_item_ids) then raise exception using errcode='55000',message='선택한 상품 중 출고할 수 없는 상품이 있습니다.'; end if;
 update public.inventory_item_fulfillments f set current_stage=case when f.current_stage in ('entitled','preparing') and f.route_mode='transfer' then 'in_transit_to_center' when f.current_stage in ('entitled','preparing') then 'center_received' else f.current_stage end,
   location_kind=case when f.current_stage in ('entitled','preparing') and f.route_mode='transfer' then 'transit' when f.current_stage in ('entitled','preparing') then 'center' else f.location_kind end,
   outbound_released=true,version=version+1,last_event_at=clock_timestamp(),updated_at=clock_timestamp()
 where f.inventory_item_id=any(p_inventory_item_ids) and not f.is_blocked and f.current_stage in ('entitled','preparing','center_received','center_stored');
 if (select count(*) from public.inventory_item_fulfillments where inventory_item_id=any(p_inventory_item_ids) and outbound_released)<>cardinality(p_inventory_item_ids) then raise exception using errcode='55000',message='검수 또는 예외 처리 중인 상품은 출고 완료할 수 없습니다.'; end if;
 update public.inventory_shipment_items x set line_status=case when f.current_stage='center_stored' then 'ready' else 'requested' end,updated_at=clock_timestamp()
 from public.inventory_item_fulfillments f where x.shipment_id=v_work.shipment_id and x.inventory_item_id=any(p_inventory_item_ids) and f.inventory_item_id=x.inventory_item_id;
 update public.inventory_shipment_store_works set status=case when not exists(select 1 from public.inventory_shipment_items x join public.inventory_item_fulfillments f on f.inventory_item_id=x.inventory_item_id where x.shipment_id=v_work.shipment_id and x.origin_store_id=v_work.origin_store_id and x.line_status not in ('excluded','cancelled') and not f.outbound_released) then 'outbound_complete' else 'collecting' end,
   completed_at=case when not exists(select 1 from public.inventory_shipment_items x join public.inventory_item_fulfillments f on f.inventory_item_id=x.inventory_item_id where x.shipment_id=v_work.shipment_id and x.origin_store_id=v_work.origin_store_id and x.line_status not in ('excluded','cancelled') and not f.outbound_released) then clock_timestamp() end,
   completed_by=case when not exists(select 1 from public.inventory_shipment_items x join public.inventory_item_fulfillments f on f.inventory_item_id=x.inventory_item_id where x.shipment_id=v_work.shipment_id and x.origin_store_id=v_work.origin_store_id and x.line_status not in ('excluded','cancelled') and not f.outbound_released) then v_actor end,
   version=version+1,updated_at=clock_timestamp() where id=p_work_id returning * into v_work;
 perform app_private.refresh_inventory_shipment_status(v_work.shipment_id,gen_random_uuid());
 insert into public.inventory_shipment_events(shipment_id,sequence_no,event_type,from_status,to_status,actor_kind,actor_user_id,idempotency_key,reason,metadata)
 values(v_work.shipment_id,coalesce((select max(sequence_no)+1 from public.inventory_shipment_events where shipment_id=v_work.shipment_id),1),'store_items_released',(select status from public.inventory_shipments where id=v_work.shipment_id),(select status from public.inventory_shipments where id=v_work.shipment_id),'user',v_actor,p_idempotency_key,p_note,jsonb_build_object('workId',p_work_id,'itemIds',to_jsonb(p_inventory_item_ids)));
 v_result:=jsonb_build_object('id',v_work.id,'version',v_work.version,'status',v_work.status,'idempotent_replay',false);
 insert into public.inventory_command_receipts values(v_actor,p_idempotency_key,'release_store_items',v_work.id,v_fp,v_result,clock_timestamp()); return v_result;
end; $$;

create or replace function public.get_inventory_center_queue(p_limit integer default 200,p_offset integer default 0)
returns jsonb language sql stable security definer set search_path = '' as $$
select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('inventoryItemId',i.id,'productId',i.product_id,'title',p.title,'imageUrl',coalesce(p.image_urls[1],''),'memberId',i.member_id,'businessId',f.business_id,'centerId',f.fulfillment_center_id,'centerName',c.name,'originStoreId',i.origin_store_id,'originStoreName',s.name,'handoffMode',f.route_mode,'physicalStatus',f.current_stage,'locationKind',f.location_kind,'storageLocationCode',f.storage_location_code,'version',f.version,'isBlocked',f.is_blocked,'workDueDate',i.work_due_date) order by c.name,f.updated_at,i.id),'[]'::jsonb))
from (select f.* from public.inventory_item_fulfillments f where f.current_stage in ('in_transit_to_center','center_received') and app_private.has_center_permission(f.fulfillment_center_id,'receive_at_center') order by f.updated_at,f.inventory_item_id limit greatest(1,least(coalesce(p_limit,200),500)) offset greatest(coalesce(p_offset,0),0)) f
join public.customer_inventory_items i on i.id=f.inventory_item_id join public.products p on p.id=i.product_id join public.stores s on s.id=i.origin_store_id join public.fulfillment_centers c on c.id=f.fulfillment_center_id;
$$;

create or replace function public.get_paid_inventory_store_queue(p_limit integer default 200,p_offset integer default 0)
returns jsonb language sql stable security definer set search_path = '' as $$
select jsonb_build_object('stores',coalesce(jsonb_agg(jsonb_build_object('storeId',q.store_id,'storeName',q.store_name,'businessId',q.business_id,'centerId',q.center_id,'centerName',q.center_name,'items',q.items) order by q.store_name,q.store_id),'[]'::jsonb)) from (
 select s.id store_id,s.name store_name,i.business_id,i.fulfillment_center_id center_id,c.name center_name,jsonb_agg(jsonb_build_object('inventoryItemId',i.id,'productId',i.product_id,'title',p.title,'imageUrl',coalesce(p.image_urls[1],''),'memberId',i.member_id,'businessId',i.business_id,'centerId',i.fulfillment_center_id,'centerName',c.name,'originStoreId',i.origin_store_id,'originStoreName',s.name,'handoffMode',f.route_mode,'physicalStatus',f.current_stage,'locationKind',f.location_kind,'storageLocationCode',f.storage_location_code,'version',f.version,'isBlocked',f.is_blocked,'workDueDate',i.work_due_date) order by i.work_due_date,i.id)items
 from public.customer_inventory_items i join public.inventory_item_fulfillments f on f.inventory_item_id=i.id join public.products p on p.id=i.product_id join public.stores s on s.id=i.origin_store_id join public.fulfillment_centers c on c.id=i.fulfillment_center_id
 where i.ownership_status='active' and f.current_stage in ('entitled','preparing') and not f.outbound_released and (public.is_owner() or public.has_store_permission(i.origin_store_id,'prepare_orders'))
 group by s.id,s.name,i.business_id,i.fulfillment_center_id,c.name order by min(i.work_due_date),s.id limit greatest(1,least(coalesce(p_limit,200),500)) offset greatest(coalesce(p_offset,0),0)
)q;
$$;

create or replace function public.release_paid_inventory_items(p_inventory_item_ids uuid[],p_expected_versions bigint[],p_idempotency_key uuid,p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_fp text; v_r public.inventory_command_receipts%rowtype; v_result jsonb;
begin
 if v_actor is null or p_idempotency_key is null or coalesce(cardinality(p_inventory_item_ids),0) not between 1 and 100 or cardinality(p_inventory_item_ids)<>cardinality(p_expected_versions) or p_inventory_item_ids is distinct from array(select x from unnest(p_inventory_item_ids)x order by x) or cardinality(p_inventory_item_ids)<>cardinality(array(select distinct x from unnest(p_inventory_item_ids)x)) then raise exception using errcode='22023',message='상품 ID를 중복 없이 정렬해 최대 100개까지 요청해 주세요.'; end if;
 v_fp:=app_private.inventory_v2_fingerprint(jsonb_build_object('items',to_jsonb(p_inventory_item_ids),'versions',to_jsonb(p_expected_versions),'note',btrim(coalesce(p_note,'')))); select * into v_r from public.inventory_command_receipts where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
 if found then if v_r.command_name<>'release_paid_items' or v_r.request_fingerprint<>v_fp then raise exception using errcode='23505',message='동일한 요청 키를 재사용할 수 없습니다.'; end if; return v_r.result||jsonb_build_object('idempotent_replay',true); end if;
 perform 1 from public.inventory_item_fulfillments where inventory_item_id=any(p_inventory_item_ids) order by inventory_item_id for update;
 if (select count(distinct (i.origin_store_id,i.business_id,i.fulfillment_center_id)) from public.customer_inventory_items i where i.id=any(p_inventory_item_ids))<>1 then raise exception using errcode='22023',message='한 매장과 출고 센터의 상품만 함께 처리할 수 있습니다.'; end if;
 if exists(select 1 from unnest(p_inventory_item_ids,p_expected_versions)z(id,ver) left join public.inventory_item_fulfillments f on f.inventory_item_id=z.id left join public.customer_inventory_items i on i.id=z.id where f.inventory_item_id is null or f.version<>z.ver or f.current_stage not in ('entitled','preparing') or f.outbound_released or f.is_blocked or i.ownership_status<>'active' or (not public.is_owner() and not public.has_store_permission(i.origin_store_id,'prepare_orders'))) then raise exception using errcode='PT409',message='출고 대상 상태 또는 권한이 변경되었습니다.'; end if;
 insert into public.inventory_item_fulfillment_events(inventory_item_id,sequence_no,event_type,from_stage,to_stage,from_location_kind,to_location_kind,actor_kind,actor_user_id,idempotency_key,note)
 select f.inventory_item_id,coalesce((select max(sequence_no)+1 from public.inventory_item_fulfillment_events where inventory_item_id=f.inventory_item_id),1),case when f.route_mode='transfer' then 'released_from_store' else 'onsite_handover' end,f.current_stage,case when f.route_mode='transfer' then 'in_transit_to_center' else 'center_received' end,f.location_kind,case when f.route_mode='transfer' then 'transit' else 'center' end,'user',v_actor,p_idempotency_key,p_note
 from public.inventory_item_fulfillments f where f.inventory_item_id=any(p_inventory_item_ids);
 update public.inventory_item_fulfillments set current_stage=case when route_mode='transfer' then 'in_transit_to_center' else 'center_received' end,location_kind=case when route_mode='transfer' then 'transit' else 'center' end,outbound_released=true,version=version+1,last_event_at=clock_timestamp(),updated_at=clock_timestamp() where inventory_item_id=any(p_inventory_item_ids);
 v_result:=jsonb_build_object('id',p_inventory_item_ids[1],'version',(select max(version) from public.inventory_item_fulfillments where inventory_item_id=any(p_inventory_item_ids)),'status','released','items',(select jsonb_agg(jsonb_build_object('id',inventory_item_id,'version',version,'status',current_stage) order by inventory_item_id) from public.inventory_item_fulfillments where inventory_item_id=any(p_inventory_item_ids)),'idempotent_replay',false); insert into public.inventory_command_receipts values(v_actor,p_idempotency_key,'release_paid_items',p_inventory_item_ids[1],v_fp,v_result,clock_timestamp()); return v_result;
end; $$;

create or replace function public.record_inventory_center_items(
 p_action text,p_inventory_item_ids uuid[],p_expected_versions bigint[],p_storage_location_code text,p_idempotency_key uuid,p_note text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_business uuid; v_center uuid; v_fp text; v_r public.inventory_command_receipts%rowtype; v_now timestamptz:=clock_timestamp(); v_result jsonb;
begin
 if v_actor is null or p_action not in ('receive','store') or p_idempotency_key is null or coalesce(cardinality(p_inventory_item_ids),0) not between 1 and 100 or cardinality(p_inventory_item_ids)<>cardinality(p_expected_versions) or p_inventory_item_ids is distinct from array(select x from unnest(p_inventory_item_ids)x order by x) or cardinality(p_inventory_item_ids)<>cardinality(array(select distinct x from unnest(p_inventory_item_ids)x)) then raise exception using errcode='22023',message='센터 처리 입력값을 확인해 주세요.'; end if;
 if p_action='store' and nullif(btrim(coalesce(p_storage_location_code,'')),'') is null then raise exception using errcode='22023',message='보관 위치를 입력해 주세요.'; end if;
 v_fp:=app_private.inventory_v2_fingerprint(jsonb_build_object('action',p_action,'items',to_jsonb(p_inventory_item_ids),'versions',to_jsonb(p_expected_versions),'location',btrim(coalesce(p_storage_location_code,'')),'note',btrim(coalesce(p_note,''))));
 select * into v_r from public.inventory_command_receipts where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
 if found then if v_r.command_name<>(case when p_action='receive' then 'center_receive' else 'center_store' end) or v_r.request_fingerprint<>v_fp then raise exception using errcode='23505',message='동일한 요청 키를 재사용할 수 없습니다.'; end if; return v_r.result||jsonb_build_object('idempotent_replay',true); end if;
 perform app_private.lock_inventory_shipment(x.shipment_id)
 from (select distinct shipment_id from public.inventory_shipment_items where inventory_item_id=any(p_inventory_item_ids) and line_status in ('requested','held','ready','packed') order by shipment_id) x;
 perform 1 from public.inventory_item_fulfillments where inventory_item_id=any(p_inventory_item_ids) order by inventory_item_id for update;
 select business_id,fulfillment_center_id into v_business,v_center from public.inventory_item_fulfillments where inventory_item_id=p_inventory_item_ids[1];
 if not app_private.has_center_permission(v_center,'receive_at_center') then raise exception using errcode='42501',message='센터 입고를 처리할 권한이 없습니다.'; end if;
 if exists(select 1 from unnest(p_inventory_item_ids,p_expected_versions) z(id,ver) left join public.inventory_item_fulfillments f on f.inventory_item_id=z.id where f.inventory_item_id is null or f.business_id<>v_business or f.fulfillment_center_id is distinct from v_center or f.version<>z.ver or f.is_blocked or (p_action='receive' and f.current_stage<>'in_transit_to_center') or (p_action='store' and f.current_stage<>'center_received')) then raise exception using errcode='PT409',message='상품 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.'; end if;
 update public.inventory_item_fulfillments f set current_stage=case when p_action='receive' then 'center_received' else 'center_stored' end,location_kind='center',storage_location_code=case when p_action='store' then btrim(p_storage_location_code) end,version=version+1,last_event_at=v_now,updated_at=v_now where inventory_item_id=any(p_inventory_item_ids);
 if p_action='store' then
   update public.customer_inventory_items set storage_started_at=coalesce(storage_started_at,v_now),storage_expires_at=coalesce(storage_expires_at,v_now+make_interval(days=>storage_duration_days)),version=version+1 where id=any(p_inventory_item_ids);
   update public.inventory_shipment_items set line_status='ready',updated_at=v_now where inventory_item_id=any(p_inventory_item_ids) and line_status='requested';
 end if;
 insert into public.inventory_item_fulfillment_events(inventory_item_id,sequence_no,event_type,from_stage,to_stage,from_location_kind,to_location_kind,actor_kind,actor_user_id,idempotency_key,note)
 select z.id,coalesce((select max(sequence_no)+1 from public.inventory_item_fulfillment_events where inventory_item_id=z.id),1),case when p_action='receive' then 'received_at_center' else 'stored_at_center' end,case when p_action='receive' then 'in_transit_to_center' else 'center_received' end,case when p_action='receive' then 'center_received' else 'center_stored' end,case when p_action='receive' then 'transit' else 'center' end,'center','user',v_actor,p_idempotency_key,p_note from unnest(p_inventory_item_ids) z(id);
 if p_action='store' then perform app_private.refresh_inventory_shipment_status(x.shipment_id,gen_random_uuid()) from (select distinct shipment_id from public.inventory_shipment_items where inventory_item_id=any(p_inventory_item_ids) and line_status='ready')x; end if;
 v_result:=jsonb_build_object('id',p_inventory_item_ids[1],'version',(select max(version) from public.inventory_item_fulfillments where inventory_item_id=any(p_inventory_item_ids)),'status',case when p_action='receive' then 'center_received' else 'center_stored' end,'items',(select jsonb_agg(jsonb_build_object('id',inventory_item_id,'version',version,'status',current_stage) order by inventory_item_id) from public.inventory_item_fulfillments where inventory_item_id=any(p_inventory_item_ids)),'idempotent_replay',false);
 insert into public.inventory_command_receipts values(v_actor,p_idempotency_key,case when p_action='receive' then 'center_receive' else 'center_store' end,p_inventory_item_ids[1],v_fp,v_result,v_now); return v_result;
end; $$;

-- Legacy shipping-fee ledger RPCs predate inventory shipments. Keep their
-- public contracts for canonical commerce shipments, but fail closed for V2.
alter function public.record_shipping_fee_payment(uuid,bigint,text,bigint,integer,text,text)
set schema app_private;
alter function app_private.record_shipping_fee_payment(uuid,bigint,text,bigint,integer,text,text)
rename to record_legacy_shipping_fee_payment;

create or replace function public.record_shipping_fee_payment(
  p_payment_id uuid,
  p_amount bigint,
  p_depositor_name text,
  p_expected_received_amount bigint,
  p_expected_ledger_entry_count integer,
  p_idempotency_key text,
  p_memo text default ''
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_payment public.shipping_fee_payments%rowtype;
begin
  if v_actor is null or not public.is_owner() then
    raise exception using errcode='42501',message='Owner 권한이 필요합니다.';
  end if;
  select * into v_payment from public.shipping_fee_payments
  where id=p_payment_id for update;
  if found and v_payment.inventory_shipment_id is not null then
    raise exception using errcode='55000',message='통합 배송비는 통합 입금 확인 절차로만 처리할 수 있습니다.';
  end if;
  return app_private.record_legacy_shipping_fee_payment(
    p_payment_id,p_amount,p_depositor_name,p_expected_received_amount,
    p_expected_ledger_entry_count,p_idempotency_key,p_memo
  );
end;
$$;

alter function public.reverse_shipping_fee_payment(text,uuid,uuid,bigint,integer,text,text)
set schema app_private;
alter function app_private.reverse_shipping_fee_payment(text,uuid,uuid,bigint,integer,text,text)
rename to reverse_legacy_shipping_fee_payment;

create or replace function public.reverse_shipping_fee_payment(
  p_expected_transfer_kind text,
  p_expected_transfer_id uuid,
  p_ledger_id uuid,
  p_expected_received_amount bigint,
  p_expected_ledger_entry_count integer,
  p_idempotency_key text,
  p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_payment public.shipping_fee_payments%rowtype;
begin
  if v_actor is null or not public.is_owner() then
    raise exception using errcode='42501',message='Owner 권한이 필요합니다.';
  end if;
  select * into v_payment from public.shipping_fee_payments
  where id=p_expected_transfer_id for update;
  if found and v_payment.inventory_shipment_id is not null then
    raise exception using errcode='55000',message='통합 배송비는 환불 절차 없이 입금 원장에서 취소할 수 없습니다.';
  end if;
  return app_private.reverse_legacy_shipping_fee_payment(
    p_expected_transfer_kind,p_expected_transfer_id,p_ledger_id,
    p_expected_received_amount,p_expected_ledger_entry_count,
    p_idempotency_key,p_reason
  );
end;
$$;

revoke all on function
  app_private.record_legacy_shipping_fee_payment(uuid,bigint,text,bigint,integer,text,text),
  app_private.reverse_legacy_shipping_fee_payment(text,uuid,uuid,bigint,integer,text,text),
  public.record_shipping_fee_payment(uuid,bigint,text,bigint,integer,text,text),
  public.reverse_shipping_fee_payment(text,uuid,uuid,bigint,integer,text,text)
from public,anon,authenticated,service_role;
grant execute on function
  public.record_shipping_fee_payment(uuid,bigint,text,bigint,integer,text,text),
  public.reverse_shipping_fee_payment(text,uuid,uuid,bigint,integer,text,text)
to authenticated;

create or replace function public.get_unified_manual_payment_queue(
  p_include_history boolean default true,
  p_limit integer default 200,
  p_offset integer default 0
)
returns jsonb language sql stable security definer set search_path = '' as $$
select case when auth.uid() is null or not public.is_staff() then jsonb_build_object('payments','[]'::jsonb,'serverTime',clock_timestamp()) else
 jsonb_build_object('payments',coalesce((select jsonb_agg(to_jsonb(q) order by q."requestedAt",q."paymentId") from (
  select * from (
   select 'commerce'::text "paymentKind",t.id "paymentId",scope.business_id "businessId",o.member_id "memberId",t.order_id::text reference,t.expected_amount "expectedAmount",led.received "receivedAmount",t.expected_amount-led.received "remainingAmount",led.entries "ledgerEntryCount",t.status,t.version,t.bank_name_snapshot "bankNameSnapshot",t.account_number_snapshot "accountNumberSnapshot",t.requested_at "requestedAt",t.confirmed_at "confirmedAt",t.confirmed_by "confirmedBy",led.last_depositor "lastDepositorName"
   from public.commerce_order_transfers t join public.commerce_orders o on o.id=t.order_id
   cross join lateral(select (array_agg(distinct s.business_id))[1] business_id,count(distinct s.business_id) business_count from public.commerce_order_items oi join public.stores s on s.id=oi.store_id where oi.order_id=t.order_id)scope
   cross join lateral(select coalesce(sum(case when l.entry_type='receipt' then l.amount else -l.amount end),0)::bigint received,count(l.id)::integer entries,(array_agg(l.depositor_name order by l.created_at desc,l.id desc) filter(where l.entry_type='receipt'))[1] last_depositor from public.manual_transfer_payment_ledger l where l.commerce_order_transfer_id=t.id)led
   where scope.business_count=1 and (p_include_history or t.status in ('awaiting_transfer','partially_paid')) and app_private.can_confirm_shared_payment(scope.business_id)
   union all
   select 'auction',m.id,s.business_id,m.buyer_id,m.order_name,m.expected_amount,led.received,m.expected_amount-led.received,led.entries,m.status,m.version,m.bank_name_snapshot,m.account_number_snapshot,m.requested_at,m.confirmed_at,m.confirmed_by,led.last_depositor
   from public.manual_transfer_orders m join public.products p on p.id=m.product_id join public.stores s on s.id=p.store_id
   cross join lateral(select coalesce(sum(case when l.entry_type='receipt' then l.amount else -l.amount end),0)::bigint received,count(l.id)::integer entries,(array_agg(l.depositor_name order by l.created_at desc,l.id desc) filter(where l.entry_type='receipt'))[1] last_depositor from public.manual_transfer_payment_ledger l where l.manual_transfer_order_id=m.id)led
   where (p_include_history or m.status='awaiting_manual_transfer') and app_private.can_confirm_shared_payment(s.business_id)
   union all
   select 'shipping_fee',f.id,f.business_id,f.member_id,'배송비',f.expected_amount,led.received,f.expected_amount-led.received,led.entries,f.status,f.version,f.bank_name_snapshot,f.account_number_snapshot,f.requested_at,f.confirmed_at,f.confirmed_by,led.last_depositor
   from public.shipping_fee_payments f
   cross join lateral(select coalesce(sum(case when l.entry_type='receipt' then l.amount else -l.amount end),0)::bigint received,count(l.id)::integer entries,(array_agg(l.depositor_name order by l.created_at desc,l.id desc) filter(where l.entry_type='receipt'))[1] last_depositor from public.manual_transfer_payment_ledger l where l.shipping_fee_payment_id=f.id)led
    where f.inventory_shipment_id is not null and (p_include_history or f.status in ('awaiting_transfer','partially_paid')) and app_private.can_confirm_shared_payment(f.business_id)
  )u order by "requestedAt","paymentId" limit greatest(1,least(coalesce(p_limit,200),500)) offset greatest(coalesce(p_offset,0),0)
 )q),'[]'::jsonb),'serverTime',clock_timestamp()) end;
$$;

create or replace function public.confirm_unified_manual_payment(
  p_payment_kind text,
  p_payment_id uuid,
  p_expected_version bigint,
  p_depositor_name text,
  p_observed_received_amount bigint,
  p_observed_ledger_entry_count integer,
  p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid:=auth.uid(); v_expected bigint; v_business uuid; v_version bigint;
  v_order uuid; v_product uuid; v_buyer uuid; v_offer uuid; v_product_status text;
  v_received bigint; v_count integer; v_result jsonb; v_fp text;
  v_receipt public.inventory_command_receipts%rowtype;
  v_commerce_order public.commerce_orders%rowtype;
  v_transfer public.commerce_order_transfers%rowtype;
  v_auction public.manual_transfer_orders%rowtype;
  v_offer_row public.auction_purchase_offers%rowtype;
  v_shipping_payment public.shipping_fee_payments%rowtype;
  v_settings public.payment_runtime_settings%rowtype;
  v_now timestamptz:=clock_timestamp();
begin
  if v_actor is null or not public.is_staff() then raise exception using errcode='42501',message='운영자 권한이 필요합니다.'; end if;
  if p_payment_kind not in ('commerce','auction','shipping_fee') or p_payment_id is null or p_expected_version is null or p_idempotency_key is null or nullif(btrim(coalesce(p_depositor_name,'')),'') is null or char_length(btrim(p_depositor_name))>80 then raise exception using errcode='22023',message='입금 확인 입력값을 확인해 주세요.'; end if;
  v_fp:=app_private.inventory_v2_fingerprint(jsonb_build_object('kind',p_payment_kind,'id',p_payment_id,'version',p_expected_version,'received',p_observed_received_amount,'count',p_observed_ledger_entry_count,'depositor',btrim(coalesce(p_depositor_name,''))));
  select * into v_receipt from public.inventory_command_receipts where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
  if found then if v_receipt.command_name<>'confirm_payment' or v_receipt.request_fingerprint<>v_fp then raise exception using errcode='23505',message='동일한 요청 키를 다른 입금 확인에 재사용할 수 없습니다.'; end if; return v_receipt.result||jsonb_build_object('idempotent_replay',true); end if;

  -- Resolve target identities without taking child locks. Every shared payment
  -- path then follows the canonical order: settings, parent/product, optional
  -- offer, transfer/order, and finally the competing PortOne order rows.
  if p_payment_kind='commerce' then
    select order_id into v_order from public.commerce_order_transfers where id=p_payment_id;
    if v_order is null then raise exception using errcode='P0002',message='입금 대상을 찾지 못했습니다.'; end if;
  elsif p_payment_kind='auction' then
    select product_id,purchase_offer_id into v_product,v_offer from public.manual_transfer_orders where id=p_payment_id;
    if v_product is null then raise exception using errcode='P0002',message='입금 대상을 찾지 못했습니다.'; end if;
  end if;

  select * into v_settings from public.payment_runtime_settings where singleton for update;
  if not found or v_settings.active_mode<>'manual_transfer' then raise exception using errcode='PT409',message='수동 계좌이체 모드에서만 입금을 확인할 수 있습니다.'; end if;

  if p_payment_kind='commerce' then
    select * into v_commerce_order from public.commerce_orders where id=v_order for update;
    select * into v_transfer from public.commerce_order_transfers where id=p_payment_id and order_id=v_order for update;
    if v_commerce_order.id is null or v_transfer.id is null then raise exception using errcode='55000',message='입금 대기 주문을 찾지 못했습니다.'; end if;
    v_expected:=v_transfer.expected_amount; v_version:=v_transfer.version;
    if v_version is distinct from p_expected_version then raise exception using errcode='PT409',message='입금 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.'; end if;
    if v_commerce_order.status not in ('awaiting_payment','partially_paid') or v_transfer.status not in ('awaiting_transfer','partially_paid') then raise exception using errcode='55000',message='입금 대기 주문을 찾지 못했습니다.'; end if;
    select (array_agg(distinct s.business_id))[1] into v_business from public.commerce_order_items oi join public.stores s on s.id=oi.store_id where oi.order_id=v_order having count(distinct s.business_id)=1;
  elsif p_payment_kind='auction' then
    select status into v_product_status from public.products where id=v_product for update;
    if not found then raise exception using errcode='P0002',message='경매 상품을 찾지 못했습니다.'; end if;
    if v_offer is not null then
      select * into v_offer_row from public.auction_purchase_offers where id=v_offer and product_id=v_product for update;
      if not found then raise exception using errcode='P0002',message='낙찰 구매 제안을 찾지 못했습니다.'; end if;
    end if;
    select * into v_auction from public.manual_transfer_orders where id=p_payment_id and product_id=v_product and purchase_offer_id is not distinct from v_offer for update;
    if not found then raise exception using errcode='55000',message='입금 대기 중인 낙찰 건이 아닙니다.'; end if;
    v_expected:=v_auction.expected_amount; v_version:=v_auction.version; v_buyer:=v_auction.buyer_id;
    if v_version is distinct from p_expected_version then raise exception using errcode='PT409',message='입금 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.'; end if;
    if v_auction.status<>'awaiting_manual_transfer' then raise exception using errcode='55000',message='입금 대기 중인 낙찰 건이 아닙니다.'; end if;
    select s.business_id into v_business from public.products p join public.stores s on s.id=p.store_id where p.id=v_product;
    perform po.id from public.payment_orders po where po.product_id=v_product order by po.id for update;
    if v_product_status<>'closed' then raise exception using errcode='55000',message='마감된 경매 상품만 입금 확정할 수 있습니다.'; end if;
    if exists(select 1 from public.payment_orders po where po.product_id=v_product and po.payment_status='결제완료' and po.portone_status='PAID') then raise exception using errcode='55000',message='PG 결제가 이미 완료된 상품입니다.'; end if;
  else
    select * into v_shipping_payment from public.shipping_fee_payments where id=p_payment_id for update;
    if not found or v_shipping_payment.inventory_shipment_id is null then raise exception using errcode='55000',message='통합 배송비 입금 대기 건을 찾지 못했습니다.'; end if;
    v_expected:=v_shipping_payment.expected_amount; v_business:=v_shipping_payment.business_id; v_version:=v_shipping_payment.version;
    if v_version is distinct from p_expected_version then raise exception using errcode='PT409',message='입금 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.'; end if;
    if v_shipping_payment.status not in ('awaiting_transfer','partially_paid') then raise exception using errcode='55000',message='통합 배송비 입금 대기 건을 찾지 못했습니다.'; end if;
  end if;

  if v_expected is null then raise exception using errcode='P0002',message='입금 대상을 찾지 못했습니다.'; end if;
  if v_version is distinct from p_expected_version then raise exception using errcode='PT409',message='입금 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.'; end if;
  if not app_private.can_confirm_shared_payment(v_business) then raise exception using errcode='42501',message='입금을 확인할 권한이 없습니다.'; end if;
  select coalesce(sum(case when entry_type='receipt' then amount else -amount end),0)::bigint,count(*)::integer into v_received,v_count from public.manual_transfer_payment_ledger where (p_payment_kind='commerce' and commerce_order_transfer_id=p_payment_id) or (p_payment_kind='auction' and manual_transfer_order_id=p_payment_id) or (p_payment_kind='shipping_fee' and shipping_fee_payment_id=p_payment_id);
  if v_received is distinct from p_observed_received_amount or v_count is distinct from p_observed_ledger_entry_count then raise exception using errcode='PT409',message='다른 운영자가 입금 상태를 변경했습니다.'; end if;
  if v_received<0 or v_received>=v_expected then raise exception using errcode='22023',message='목록에 표시된 미입금 잔액 전체만 확인할 수 있습니다.'; end if;
  if p_payment_kind='auction' and v_offer is not null then
    if v_offer_row.id is null or v_offer_row.product_id<>v_product or v_offer_row.bidder_id is distinct from v_buyer or v_offer_row.amount<>v_expected or v_offer_row.status not in ('accepted','payment_due') or (v_offer_row.payment_due_at is not null and v_now>=v_offer_row.payment_due_at) then raise exception using errcode='55000',message='현재 구매 제안과 입금 대상이 일치하지 않습니다.'; end if;
  elsif p_payment_kind='auction' then
    perform 1 from (select bidder_id,amount from public.auction_bids where product_id=v_product order by amount desc,created_at desc,id desc limit 1)b where b.bidder_id=v_buyer and b.amount=v_expected;
    if not found then raise exception using errcode='55000',message='낙찰자 또는 입금 금액 검증에 실패했습니다.'; end if;
  end if;
  if p_payment_kind='auction' then
    if not public.is_owner() and public.is_owner_hidden_test_member(v_buyer) then raise exception using errcode='42501',message='확인할 수 없는 입금 주문입니다.'; end if;
    if (v_received=0 and (v_auction.payment_deadline_held_at is not null or v_auction.due_at_before_payment_hold is not null or v_auction.offer_due_at_before_payment_hold is not null)) or (v_received between 1 and v_expected-1 and (v_auction.payment_deadline_held_at is null or v_auction.due_at is not null or (v_offer is not null and v_offer_row.payment_due_at is not null))) then raise exception using errcode='23514',message='낙찰 부분입금의 기한 보류 상태를 먼저 검토해야 합니다.'; end if;
    if v_auction.due_at is not null and v_now>=v_auction.due_at then raise exception using errcode='55000',message='입금 기한이 지나 자동 승계 검토가 필요한 낙찰 건입니다.'; end if;
  end if;

  if p_payment_kind in ('commerce','auction') then
    -- This RPC has already established the shared business/center permission
    -- and locked the canonical parent rows. Do not delegate to the legacy
    -- receipt RPC: its historic single-store operator check would incorrectly
    -- reject an authorized operator from another center.
    insert into public.manual_transfer_payment_ledger(
      transfer_kind,manual_transfer_order_id,commerce_order_transfer_id,
      entry_type,amount,depositor_name,memo,recorded_by,idempotency_key
    ) values(
      p_payment_kind,
      case when p_payment_kind='auction' then p_payment_id end,
      case when p_payment_kind='commerce' then p_payment_id end,
      'receipt',v_expected-v_received,btrim(p_depositor_name),'',v_actor,p_idempotency_key::text
    );
    if p_payment_kind='commerce' then
      perform public.confirm_commerce_order_transfer(v_order);
      update public.commerce_order_items set storage_expires_at=null where order_id=v_order and payment_status='paid';
      select version into v_version from public.commerce_order_transfers where id=p_payment_id;
    else
      update public.manual_transfer_orders
      set status='confirmed',confirmed_at=v_now,confirmed_by=v_actor
      where id=p_payment_id and status='awaiting_manual_transfer';
      if not found then raise exception using errcode='PT409',message='이미 처리된 낙찰 입금입니다.'; end if;
      if public.is_owner_hidden_test_member(v_buyer) then
        perform set_config('app.owner_hidden_test_actor',v_actor::text,true);
        perform public.insert_owner_hidden_test_member_audit(
          v_actor,v_buyer,'test_member.manual_transfer_confirmed',
          jsonb_build_object('manual_transfer_order_id',p_payment_id,'product_id',v_product,'expected_amount',v_expected)
        );
      end if;
      select version into v_version from public.manual_transfer_orders where id=p_payment_id;
    end if;
    v_received:=v_expected;
    v_count:=v_count+1;
  else
    insert into public.manual_transfer_payment_ledger(transfer_kind,shipping_fee_payment_id,entry_type,amount,depositor_name,memo,recorded_by,idempotency_key)
    values('shipping',p_payment_id,'receipt',v_expected-v_received,btrim(p_depositor_name),'',v_actor,p_idempotency_key::text);
    update public.shipping_fee_payments set status='confirmed',confirmed_at=clock_timestamp(),confirmed_by=v_actor where id=p_payment_id and status in ('awaiting_transfer','partially_paid');
    if not found then raise exception using errcode='PT409',message='이미 처리된 배송비 입금입니다.'; end if;
    insert into public.store_financial_entries(business_id,inventory_shipment_id,entry_kind,amount,occurred_at,idempotency_key,metadata) select business_id,inventory_shipment_id,'shipping_fee',expected_amount,clock_timestamp(),p_idempotency_key,jsonb_build_object('shippingFeePaymentId',id) from public.shipping_fee_payments where id=p_payment_id;
    select version into v_version from public.shipping_fee_payments where id=p_payment_id;
    v_received := v_expected;
    v_count := v_count+1;
  end if;
  v_result:=jsonb_build_object('payment_kind',p_payment_kind,'payment_id',p_payment_id,'version',v_version,'received_amount',v_received,'remaining_amount',v_expected-v_received,'ledger_entry_count',v_count,'status','confirmed','idempotent_replay',false);
  insert into public.inventory_command_receipts values(v_actor,p_idempotency_key,'confirm_payment',p_payment_id,v_fp,v_result,clock_timestamp());
  return v_result;
end; $$;

-- Buyer inventory and item-selected shipments -----------------------------

create or replace function public.get_my_inventory_overview()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'rolloutEnabled',coalesce(bool_or(rs.unified_inventory_reads_enabled),false),
    'items',coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'productId',i.product_id,'title',p.title,'imageUrl',coalesce(p.image_urls[1],''),
    'sourceKind',i.source_kind,'sourceReference',coalesce(i.commerce_order_item_id,i.manual_transfer_order_id,i.legacy_payment_order_id),
    'originStoreId',i.origin_store_id,'originStoreName',s.name,'ownershipStatus',i.ownership_status,
    'physicalStatus',f.current_stage,'locationKind',f.location_kind,
    'rolloutEnabled',rs.unified_inventory_reads_enabled,
    'itemSelectedShipmentsEnabled',rs.item_selected_shipments_enabled,
    'requestEligible',(rs.item_selected_shipments_enabled and i.ownership_status='active' and f.current_stage in ('entitled','preparing','center_received','center_stored') and not f.is_blocked and si.shipment_id is null and i.legacy_commerce_shipment_id is null),
    'requestBlockReason',case when not rs.item_selected_shipments_enabled then 'rollout_disabled' when i.ownership_status<>'active' then 'ownership_'||i.ownership_status when f.is_blocked then f.block_reason when f.current_stage not in ('entitled','preparing','center_received','center_stored') then 'physical_'||f.current_stage when si.shipment_id is not null then 'active_shipment' when i.legacy_commerce_shipment_id is not null then 'legacy_shipment' end,
    'storageStartedAt',i.storage_started_at,'storageExpiresAt',i.storage_expires_at,'activeShipmentId',si.shipment_id,
    'exceptionKind',e.kind,'exceptionStatus',e.status,'exceptionResolution',e.resolution,'exceptionPublicReason',e.public_reason
  ) order by i.paid_at desc,i.id),'[]'::jsonb),'serverTime',clock_timestamp())
  from public.customer_inventory_items i join public.products p on p.id=i.product_id join public.stores s on s.id=i.origin_store_id
  join public.inventory_item_fulfillments f on f.inventory_item_id=i.id
  join public.inventory_fulfillment_rollout_settings rs on rs.business_id=i.business_id
  left join lateral (select x.shipment_id from public.inventory_shipment_items x where x.inventory_item_id=i.id and x.line_status in ('requested','held','ready','packed') limit 1) si on true
  left join lateral (select c.kind,c.status,c.resolution,c.public_reason from public.inventory_exception_cases c where c.inventory_item_id=i.id order by (c.status='open') desc,c.created_at desc limit 1) e on true
  where i.member_id=auth.uid() and rs.unified_inventory_reads_enabled;
$$;

create or replace function app_private.refresh_inventory_shipment_status(p_shipment_id uuid,p_event_key uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old text; v_new text; v_active integer; v_sh public.inventory_shipments%rowtype; v_fee public.shipping_fee_payments%rowtype;
begin
  select * into v_sh from public.inventory_shipments where id=p_shipment_id for update; v_old:=v_sh.status;
  if v_old in ('packed','shipped','cancelled') then return; end if;
  select count(*) into v_active from public.inventory_shipment_items where shipment_id=p_shipment_id and line_status not in ('excluded','cancelled');
  if v_active=0 then
    if v_sh.settlement_method='shipping_credit' then
      update public.member_accounts set shipping_credit_count=shipping_credit_count+1,updated_at=clock_timestamp() where member_id=v_sh.member_id;
      insert into public.shipping_credit_ledger(member_id,business_id,delta,reason,created_by) values(v_sh.member_id,v_sh.business_id,1,'refund',auth.uid());
    elsif v_sh.settlement_method='waiver' then
      update public.shipping_fee_waiver_entitlements set status='available',consumed_shipment_id=null,consumed_at=null where id=v_sh.shipping_fee_waiver_id and status='consumed';
    else
      select * into v_fee from public.shipping_fee_payments where id=v_sh.shipping_fee_payment_id for update;
      if v_fee.status='confirmed' then
        insert into public.shipping_fee_refunds(inventory_shipment_id,shipping_fee_payment_id,member_id,business_id,amount) values(v_sh.id,v_fee.id,v_sh.member_id,v_sh.business_id,v_fee.expected_amount) on conflict(inventory_shipment_id) do nothing;
      else
        update public.shipping_fee_payments set status='cancelled' where id=v_fee.id;
      end if;
    end if;
    update public.inventory_shipment_store_works set status='cancelled',completed_at=null,completed_by=null,version=version+1,updated_at=clock_timestamp() where shipment_id=v_sh.id and status<>'cancelled';
    update public.inventory_shipments set status='cancelled',cancelled_at=clock_timestamp(),cancellation_reason='all_lines_excluded',version=version+1,updated_at=clock_timestamp() where id=v_sh.id;
    insert into public.inventory_shipment_events(shipment_id,sequence_no,event_type,from_status,to_status,actor_kind,idempotency_key,reason) values(v_sh.id,coalesce((select max(sequence_no)+1 from public.inventory_shipment_events where shipment_id=v_sh.id),1),'cancelled',v_old,'cancelled','system',p_event_key,'all_lines_excluded');
    return;
  end if;
  select case
    when count(*) filter(where line_status in ('requested','held'))>0 then 'collecting'
    when count(*) filter(where line_status in ('ready'))>0 then 'ready_to_pack'
    else 'reconciliation_required' end into v_new
  from public.inventory_shipment_items where shipment_id=p_shipment_id and line_status not in ('excluded','cancelled');
  if v_new is distinct from v_old then
    update public.inventory_shipments set status=v_new,version=version+1,updated_at=clock_timestamp() where id=p_shipment_id;
    insert into public.inventory_shipment_events(shipment_id,sequence_no,event_type,from_status,to_status,actor_kind,idempotency_key)
    values(p_shipment_id,coalesce((select max(sequence_no)+1 from public.inventory_shipment_events where shipment_id=p_shipment_id),1),
      case when v_new='ready_to_pack' then 'ready_to_pack' else 'reconciliation_required' end,v_old,v_new,'system',p_event_key)
    on conflict(shipment_id,idempotency_key) do nothing;
  end if;
end; $$;

create or replace function public.request_inventory_shipment(
  p_inventory_item_ids uuid[],
  p_address_id uuid,
  p_settlement_method text,
  p_shipping_fee_amount bigint,
  p_bank_name_snapshot text,
  p_account_number_snapshot text,
  p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid:=auth.uid(); v_member uuid; v_business uuid; v_center uuid; v_count int; v_shipment uuid:=gen_random_uuid();
  v_payment uuid; v_credit uuid; v_waiver uuid; v_method text:=p_settlement_method; v_address jsonb; v_fp text; v_receipt public.inventory_command_receipts%rowtype; v_status text:='collecting'; v_shipment_version bigint; v_result jsonb; v_config_fee bigint; v_config_bank text; v_config_account text;
begin
  if v_actor is null or not public.is_member() then raise exception using errcode='42501',message='구매자 로그인이 필요합니다.'; end if;
  if p_idempotency_key is null or coalesce(cardinality(p_inventory_item_ids),0) not between 1 and 100 or p_settlement_method not in ('shipping_credit','manual_transfer','waiver') then raise exception using errcode='22023',message='배송 신청 입력값을 확인해 주세요.'; end if;
  if cardinality(p_inventory_item_ids)<>cardinality(array(select distinct x from unnest(p_inventory_item_ids) x)) then raise exception using errcode='22023',message='중복 상품을 선택할 수 없습니다.'; end if;
  -- Fee and bank snapshots are server-controlled below. Legacy input arguments
  -- remain in the signature for compatibility but never authorize a quote.
  v_fp:=app_private.inventory_v2_fingerprint(jsonb_build_object('items',(select jsonb_agg(x order by x) from unnest(p_inventory_item_ids)x),'address',p_address_id,'method',p_settlement_method));
  select * into v_receipt from public.inventory_command_receipts where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
  if found then if v_receipt.command_name<>'request_shipment' or v_receipt.request_fingerprint<>v_fp then raise exception using errcode='23505',message='동일한 요청 키를 다른 배송 신청에 재사용할 수 없습니다.'; end if; return v_receipt.result||jsonb_build_object('idempotent_replay',true); end if;
  perform 1 from public.customer_inventory_items where id=any(p_inventory_item_ids) order by id for update;
  select member_id,business_id,fulfillment_center_id into v_member,v_business,v_center from public.customer_inventory_items where id=any(p_inventory_item_ids) order by id limit 1;
  select count(*) into v_count from public.customer_inventory_items where id=any(p_inventory_item_ids);
  if v_count<>cardinality(p_inventory_item_ids) or v_member is distinct from v_actor or exists(select 1 from public.customer_inventory_items where id=any(p_inventory_item_ids) and (member_id<>v_actor or business_id<>v_business or fulfillment_center_id is distinct from v_center or ownership_status<>'active')) then raise exception using errcode='42501',message='선택한 상품의 소유권 또는 출고 센터가 일치하지 않습니다.'; end if;
  if exists(select 1 from public.customer_inventory_items i where i.id=any(p_inventory_item_ids) and (i.legacy_commerce_shipment_id is not null or exists(select 1 from public.commerce_shipment_items csi where csi.order_item_id=i.commerce_order_item_id))) then raise exception using errcode='55000',message='기존 배송에 포함된 상품은 다시 신청할 수 없습니다.'; end if;
  if not exists(select 1 from public.inventory_fulfillment_rollout_settings where business_id=v_business and item_selected_shipments_enabled) then raise exception using errcode='55000',message='선택 배송 기능이 아직 활성화되지 않았습니다.'; end if;
  if v_center is null or exists(select 1 from public.inventory_item_fulfillments where inventory_item_id=any(p_inventory_item_ids) and (current_stage not in ('entitled','preparing','center_received','center_stored') or is_blocked)) then raise exception using errcode='55000',message='현재 배송을 신청할 수 없는 상품이 포함되어 있습니다.'; end if;
  select jsonb_build_object('recipientName',recipient_name,'phone',phone,'postalCode',postal_code,'address',address,'label',label) into v_address from public.shipping_addresses where id=p_address_id and member_id=v_actor;
  if v_address is null then raise exception using errcode='P0002',message='배송지를 찾지 못했습니다.'; end if;
  select id into v_waiver from public.shipping_fee_waiver_entitlements where member_id=v_actor and business_id=v_business and status='available' order by created_at,id limit 1 for update skip locked;
  if v_waiver is not null then v_method:='waiver'; end if;
  if v_method='manual_transfer' then
    select shipping_fee_amount into v_config_fee from public.inventory_fulfillment_rollout_settings where business_id=v_business;
    select bank_name,account_number into v_config_bank,v_config_account from public.payment_runtime_settings where singleton and active_mode='manual_transfer';
    if v_config_fee is null or nullif(btrim(coalesce(v_config_bank,'')),'') is null or nullif(btrim(coalesce(v_config_account,'')),'') is null then raise exception using errcode='55000',message='현재 운영 배송비 또는 입금 계좌가 설정되지 않았습니다.'; end if;
    insert into public.shipping_fee_payments(member_id,business_id,expected_amount,bank_name_snapshot,account_number_snapshot) values(v_actor,v_business,v_config_fee,btrim(v_config_bank),btrim(v_config_account)) returning id into v_payment;
  elsif v_method='shipping_credit' then
    update public.member_accounts set shipping_credit_count=shipping_credit_count-1,updated_at=clock_timestamp() where member_id=v_actor and shipping_credit_count>0;
    if not found then raise exception using errcode='55000',message='사용 가능한 배송권이 없습니다.'; end if;
    insert into public.shipping_credit_ledger(member_id,business_id,delta,reason,created_by) values(v_actor,v_business,-1,'used',v_actor) returning id into v_credit;
  else
    if v_waiver is null then raise exception using errcode='55000',message='사용 가능한 무료 배송 권한이 없습니다.'; end if;
  end if;
  insert into public.inventory_shipments(id,member_id,business_id,fulfillment_center_id,status,settlement_method,shipping_fee_payment_id,shipping_credit_ledger_id,shipping_fee_waiver_id,address_id,address_snapshot)
  values(v_shipment,v_actor,v_business,v_center,'collecting',v_method,v_payment,v_credit,v_waiver,p_address_id,v_address);
  if v_payment is not null then update public.shipping_fee_payments set inventory_shipment_id=v_shipment where id=v_payment; end if;
  if v_credit is not null then update public.shipping_credit_ledger set inventory_shipment_id=v_shipment where id=v_credit; end if;
  if v_waiver is not null then update public.shipping_fee_waiver_entitlements set status='consumed',consumed_shipment_id=v_shipment,consumed_at=clock_timestamp() where id=v_waiver; end if;
  insert into public.inventory_shipment_items(shipment_id,inventory_item_id,member_id,business_id,fulfillment_center_id,product_id,origin_store_id,line_status)
  select v_shipment,i.id,i.member_id,i.business_id,i.fulfillment_center_id,i.product_id,i.origin_store_id,case when f.current_stage='center_stored' and f.outbound_released then 'ready' else 'requested' end from public.customer_inventory_items i join public.inventory_item_fulfillments f on f.inventory_item_id=i.id where i.id=any(p_inventory_item_ids) order by i.id;
  insert into public.inventory_shipment_store_works(shipment_id,business_id,origin_store_id,fulfillment_center_id,route_mode,status,completed_at,completed_by)
  select v_shipment,i.business_id,i.origin_store_id,i.fulfillment_center_id,i.route_mode,case when bool_and(f.outbound_released) then 'outbound_complete' else 'collecting' end,case when bool_and(f.outbound_released) then clock_timestamp() end,case when bool_and(f.outbound_released) then v_actor end from public.customer_inventory_items i join public.inventory_item_fulfillments f on f.inventory_item_id=i.id where i.id=any(p_inventory_item_ids) group by i.business_id,i.origin_store_id,i.fulfillment_center_id,i.route_mode;
  insert into public.inventory_shipment_events(shipment_id,sequence_no,event_type,to_status,actor_kind,actor_user_id,idempotency_key,metadata)
  values(v_shipment,1,'requested','collecting','user',v_actor,p_idempotency_key,jsonb_build_object('itemCount',v_count));
  perform app_private.lock_inventory_shipment(v_shipment);
  perform app_private.refresh_inventory_shipment_status(v_shipment,gen_random_uuid());
  select status,version into v_status,v_shipment_version from public.inventory_shipments where id=v_shipment;
  v_result:=jsonb_build_object('shipment_id',v_shipment,'status',v_status,'version',v_shipment_version,'settlement_method',v_method,'payment',case when v_payment is null then null else jsonb_build_object('id',v_payment,'expected_amount',v_config_fee,'status','awaiting_transfer','bank_name_snapshot',v_config_bank,'account_number_snapshot',v_config_account) end,'idempotent_replay',false);
  insert into public.inventory_command_receipts values(v_actor,p_idempotency_key,'request_shipment',v_shipment,v_fp,v_result,clock_timestamp()); return v_result;
end; $$;

-- Structured exceptions, manual refunds, and private account material -------

create or replace function public.get_inventory_exception_queue(p_include_resolved boolean default false,p_limit integer default 100,p_offset integer default 0)
returns jsonb language sql stable security definer set search_path = '' as $$
select jsonb_build_object('cases',coalesce(jsonb_agg(jsonb_build_object('id',e.id,'inventoryItemId',e.inventory_item_id,'productId',i.product_id,'title',p.title,'imageUrl',coalesce(p.image_urls[1],''),'memberId',i.member_id,'businessId',e.business_id,'originStoreId',i.origin_store_id,'originStoreName',s.name,'shipmentId',e.shipment_id,'kind',e.kind,'status',e.status,'resolution',e.resolution,'publicReason',e.public_reason,'internalNote',e.internal_note,'dueAt',e.review_due_at,'version',e.version,'createdAt',e.created_at,'evidencePaths',to_jsonb(e.evidence_paths)) order by e.created_at,e.id),'[]'::jsonb))
from (select e.* from public.inventory_exception_cases e where (p_include_resolved or e.status='open') and (public.is_owner() or public.has_store_permission(e.origin_store_id,'prepare_orders') or public.has_business_permission(e.business_id,'receive_at_center') or public.has_business_permission(e.business_id,'create_shipments')) order by e.created_at,e.id limit greatest(1,least(coalesce(p_limit,100),500)) offset greatest(coalesce(p_offset,0),0)) e
join public.customer_inventory_items i on i.id=e.inventory_item_id join public.products p on p.id=i.product_id join public.stores s on s.id=i.origin_store_id;
$$;

create or replace function public.get_inventory_exception_candidates(p_limit integer default 200,p_offset integer default 0)
returns jsonb language sql stable security definer set search_path = '' as $$
select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('inventoryItemId',i.id,'productId',i.product_id,'title',p.title,'imageUrl',coalesce(p.image_urls[1],''),'memberId',i.member_id,'businessId',i.business_id,'originStoreId',i.origin_store_id,'originStoreName',s.name,'activeShipmentId',x.shipment_id,'physicalStatus',f.current_stage,'locationKind',f.location_kind,'isBlocked',f.is_blocked,'blockReason',f.block_reason,'version',f.version) order by i.paid_at,i.id),'[]'::jsonb))
from (select i.* from public.customer_inventory_items i join public.inventory_item_fulfillments candidate_f on candidate_f.inventory_item_id=i.id where i.ownership_status='active' and candidate_f.current_stage not in ('packed','shipped','cancelled') and (public.is_owner() or public.has_store_permission(i.origin_store_id,'prepare_orders') or public.has_business_permission(i.business_id,'receive_at_center') or public.has_business_permission(i.business_id,'create_shipments')) order by i.paid_at,i.id limit greatest(1,least(coalesce(p_limit,200),500)) offset greatest(coalesce(p_offset,0),0)) i
join public.products p on p.id=i.product_id join public.stores s on s.id=i.origin_store_id join public.inventory_item_fulfillments f on f.inventory_item_id=i.id
left join lateral(select si.shipment_id from public.inventory_shipment_items si where si.inventory_item_id=i.id and si.line_status in ('requested','held','ready','packed') limit 1)x on true;
$$;

create or replace function public.open_inventory_exception(p_inventory_item_id uuid,p_kind text,p_public_reason text,p_internal_note text,p_due_at timestamptz,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_i public.customer_inventory_items%rowtype; v_f public.inventory_item_fulfillments%rowtype; v_case uuid:=gen_random_uuid(); v_shipment uuid; v_fp text; v_r public.inventory_command_receipts%rowtype; v_result jsonb;
begin
 if v_actor is null or p_kind not in ('inspection_required','missing','offline_sold','additional_wait','refund_required') or char_length(btrim(coalesce(p_public_reason,''))) not between 3 and 1000 or p_idempotency_key is null then raise exception using errcode='22023',message='상품 예외 입력값을 확인해 주세요.'; end if;
 v_fp:=app_private.inventory_v2_fingerprint(jsonb_build_object('item',p_inventory_item_id,'kind',p_kind,'public',btrim(p_public_reason),'internal',btrim(coalesce(p_internal_note,'')),'due',p_due_at));
 select * into v_r from public.inventory_command_receipts where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
 if found then if v_r.command_name<>'open_exception' or v_r.request_fingerprint<>v_fp then raise exception using errcode='23505',message='동일한 요청 키를 재사용할 수 없습니다.'; end if; return v_r.result||jsonb_build_object('idempotent_replay',true); end if;
 select shipment_id into v_shipment from public.inventory_shipment_items where inventory_item_id=p_inventory_item_id and line_status in ('requested','held','ready','packed') limit 1;
 if v_shipment is not null then perform app_private.lock_inventory_shipment(v_shipment); end if;
 select * into v_i from public.customer_inventory_items where id=p_inventory_item_id for update;
 select * into v_f from public.inventory_item_fulfillments where inventory_item_id=p_inventory_item_id for update;
 if v_i.id is null then raise exception using errcode='P0002',message='보관 상품을 찾지 못했습니다.'; end if;
 if v_i.ownership_status<>'active' or v_f.current_stage in ('packed','shipped','cancelled') then raise exception using errcode='55000',message='현재 단계에서는 상품 예외를 시작할 수 없습니다.'; end if;
 if not public.is_owner() and not public.has_store_permission(v_i.origin_store_id,'prepare_orders') and not public.has_business_permission(v_i.business_id,'receive_at_center') and not public.has_business_permission(v_i.business_id,'create_shipments') then raise exception using errcode='42501',message='상품 예외를 등록할 권한이 없습니다.'; end if;
 if exists(select 1 from public.inventory_exception_cases where inventory_item_id=p_inventory_item_id and status='open') then raise exception using errcode='55000',message='이미 처리 중인 상품 예외가 있습니다.'; end if;
 select shipment_id into v_shipment from public.inventory_shipment_items where inventory_item_id=p_inventory_item_id and line_status in ('requested','held','ready','packed') limit 1;
 insert into public.inventory_exception_cases(id,inventory_item_id,shipment_id,business_id,origin_store_id,kind,public_reason,internal_note,review_due_at,opened_by) values(v_case,p_inventory_item_id,v_shipment,v_i.business_id,v_i.origin_store_id,p_kind,btrim(p_public_reason),nullif(btrim(coalesce(p_internal_note,'')),''),p_due_at,v_actor);
 update public.inventory_item_fulfillments set is_blocked=true,block_reason=btrim(p_public_reason),version=version+1,updated_at=clock_timestamp() where inventory_item_id=p_inventory_item_id;
 if v_shipment is not null then update public.inventory_shipment_items set line_status='held',updated_at=clock_timestamp() where shipment_id=v_shipment and inventory_item_id=p_inventory_item_id and line_status in ('requested','ready'); perform app_private.refresh_inventory_shipment_status(v_shipment,gen_random_uuid()); end if;
 insert into public.inventory_exception_events(case_id,sequence_no,event_type,actor_user_id,idempotency_key,metadata) values(v_case,1,'opened',v_actor,p_idempotency_key,jsonb_build_object('kind',p_kind));
 insert into public.inventory_item_fulfillment_events(inventory_item_id,sequence_no,event_type,from_stage,to_stage,from_location_kind,to_location_kind,actor_kind,actor_user_id,idempotency_key,reason_code,note) values(p_inventory_item_id,coalesce((select max(sequence_no)+1 from public.inventory_item_fulfillment_events where inventory_item_id=p_inventory_item_id),1),'exception_opened',v_f.current_stage,v_f.current_stage,v_f.location_kind,v_f.location_kind,'user',v_actor,p_idempotency_key,p_kind,p_public_reason);
 v_result:=jsonb_build_object('id',v_case,'version',0,'status','open','idempotent_replay',false); insert into public.inventory_command_receipts values(v_actor,p_idempotency_key,'open_exception',v_case,v_fp,v_result,clock_timestamp()); return v_result;
end; $$;

create or replace function public.append_inventory_exception_evidence(p_case_id uuid,p_object_path text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_case public.inventory_exception_cases%rowtype; v_fp text; v_r public.inventory_command_receipts%rowtype; v_result jsonb;
begin
 if v_actor is null or p_idempotency_key is null or char_length(coalesce(p_object_path,'')) not between 1 and 500 then raise exception using errcode='22023',message='증빙 입력값을 확인해 주세요.'; end if;
 v_fp:=app_private.inventory_v2_fingerprint(jsonb_build_object('case',p_case_id,'path',p_object_path)); select * into v_r from public.inventory_command_receipts where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
 if found then if v_r.command_name<>'append_exception_evidence' or v_r.request_fingerprint<>v_fp then raise exception using errcode='23505',message='동일한 요청 키를 재사용할 수 없습니다.'; end if; return v_r.result||jsonb_build_object('idempotent_replay',true); end if;
 select * into v_case from public.inventory_exception_cases where id=p_case_id for update;
 if not found or v_case.status<>'open' then raise exception using errcode='55000',message='열린 예외 건을 찾지 못했습니다.'; end if;
 if not public.is_owner() and not public.has_store_permission(v_case.origin_store_id,'prepare_orders') and not public.has_business_permission(v_case.business_id,'receive_at_center') and not public.has_business_permission(v_case.business_id,'create_shipments') then raise exception using errcode='42501',message='증빙을 등록할 권한이 없습니다.'; end if;
 if p_object_path !~ ('^inventory-exception-evidence/'||v_case.business_id::text||'/'||v_case.id::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$') then raise exception using errcode='22023',message='예외 증빙 경로 형식이 올바르지 않습니다.'; end if;
 if p_object_path=any(v_case.evidence_paths) then raise exception using errcode='23505',message='이미 등록된 증빙입니다.'; end if;
 update public.inventory_exception_cases set evidence_paths=array_append(evidence_paths,p_object_path),version=version+1,updated_at=clock_timestamp() where id=p_case_id returning * into v_case;
 insert into public.inventory_exception_events(case_id,sequence_no,event_type,actor_user_id,idempotency_key,metadata) values(p_case_id,coalesce((select max(sequence_no)+1 from public.inventory_exception_events where case_id=p_case_id),1),'evidence_appended',v_actor,p_idempotency_key,jsonb_build_object('objectPath',p_object_path));
 v_result:=jsonb_build_object('case_id',p_case_id,'id',p_case_id,'version',v_case.version,'status',v_case.status,'idempotent_replay',false); insert into public.inventory_command_receipts values(v_actor,p_idempotency_key,'append_exception_evidence',p_case_id,v_fp,v_result,clock_timestamp()); return v_result;
end; $$;

create or replace function public.resolve_inventory_exception(p_case_id uuid,p_expected_version bigint,p_resolution text,p_public_reason text,p_internal_note text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_case public.inventory_exception_cases%rowtype; v_i public.customer_inventory_items%rowtype; v_f public.inventory_item_fulfillments%rowtype; v_refund uuid; v_fp text; v_r public.inventory_command_receipts%rowtype; v_result jsonb;
begin
 if v_actor is null or p_resolution not in ('resume','exclude_for_later','refund') or char_length(btrim(coalesce(p_public_reason,''))) not between 3 and 1000 or p_idempotency_key is null then raise exception using errcode='22023',message='예외 해결 입력값을 확인해 주세요.'; end if;
 v_fp:=app_private.inventory_v2_fingerprint(jsonb_build_object('case',p_case_id,'version',p_expected_version,'resolution',p_resolution,'public',btrim(p_public_reason),'internal',btrim(coalesce(p_internal_note,'')))); select * into v_r from public.inventory_command_receipts where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
 if found then if v_r.command_name<>'resolve_exception' or v_r.request_fingerprint<>v_fp then raise exception using errcode='23505',message='동일한 요청 키를 재사용할 수 없습니다.'; end if; return v_r.result||jsonb_build_object('idempotent_replay',true); end if;
 select * into v_case from public.inventory_exception_cases where id=p_case_id for update; if not found then raise exception using errcode='P0002',message='예외 건을 찾지 못했습니다.'; end if;
 if v_case.status<>'open' or v_case.version<>p_expected_version then raise exception using errcode='PT409',message='예외 건 상태가 변경되었습니다.'; end if;
 if v_case.kind in ('offline_sold','refund_required') and p_resolution<>'refund' then raise exception using errcode='22023',message='오프라인 판매 또는 환불 대상 상품은 환불로만 처리할 수 있습니다.'; end if;
 if not public.is_owner() and not public.has_store_permission(v_case.origin_store_id,'prepare_orders') and not public.has_business_permission(v_case.business_id,'receive_at_center') and not public.has_business_permission(v_case.business_id,'create_shipments') then raise exception using errcode='42501',message='예외 건을 해결할 권한이 없습니다.'; end if;
 if v_case.shipment_id is not null then perform app_private.lock_inventory_shipment(v_case.shipment_id); end if;
 select * into v_i from public.customer_inventory_items where id=v_case.inventory_item_id for update; select * into v_f from public.inventory_item_fulfillments where inventory_item_id=v_case.inventory_item_id for update;
 update public.inventory_exception_cases set status='resolved',resolution=p_resolution,public_reason=btrim(p_public_reason),internal_note=nullif(btrim(coalesce(p_internal_note,'')),''),resolved_by=v_actor,resolved_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() where id=p_case_id returning * into v_case;
 if p_resolution='resume' then
   update public.inventory_item_fulfillments set is_blocked=false,block_reason=null,version=version+1,updated_at=clock_timestamp() where inventory_item_id=v_i.id;
   if v_case.shipment_id is not null then update public.inventory_shipment_items set line_status=case when v_f.current_stage='center_stored' then 'ready' else 'requested' end,updated_at=clock_timestamp() where shipment_id=v_case.shipment_id and inventory_item_id=v_i.id and line_status='held'; end if;
 elsif p_resolution='exclude_for_later' then
   update public.inventory_item_fulfillments set is_blocked=false,block_reason=null,version=version+1,updated_at=clock_timestamp() where inventory_item_id=v_i.id;
   if v_case.shipment_id is not null then update public.inventory_shipment_items set line_status='excluded',excluded_reason=btrim(p_public_reason),updated_at=clock_timestamp() where shipment_id=v_case.shipment_id and inventory_item_id=v_i.id and line_status='held'; end if;
 else
   if coalesce((select sum(r.amount) from public.manual_refunds r where r.inventory_item_id=v_i.id and r.status in ('requested','approved','completed')),0)+v_i.paid_amount>v_i.paid_amount then raise exception using errcode='23514',message='환불 합계가 원 결제액을 초과할 수 없습니다.'; end if;
   update public.customer_inventory_items set ownership_status='refund_pending',version=version+1 where id=v_i.id;
   if v_case.shipment_id is not null then update public.inventory_shipment_items set line_status='excluded',excluded_reason=btrim(p_public_reason),updated_at=clock_timestamp() where shipment_id=v_case.shipment_id and inventory_item_id=v_i.id and line_status='held'; end if;
   insert into public.manual_refunds(inventory_item_id,exception_case_id,member_id,business_id,origin_store_id,amount,requested_by) values(v_i.id,v_case.id,v_i.member_id,v_i.business_id,v_i.origin_store_id,v_i.paid_amount,v_actor) returning id into v_refund;
   insert into public.manual_refund_events(refund_id,sequence_no,event_type,actor_user_id,idempotency_key,metadata) values(v_refund,1,'requested',v_actor,p_idempotency_key,jsonb_build_object('publicReason',p_public_reason));
 end if;
 if v_case.shipment_id is not null then
   update public.inventory_shipment_store_works w set
     status=case when exists(select 1 from public.inventory_shipment_items x join public.inventory_item_fulfillments f on f.inventory_item_id=x.inventory_item_id where x.shipment_id=w.shipment_id and x.origin_store_id=w.origin_store_id and x.line_status not in ('excluded','cancelled') and not f.outbound_released) then 'collecting' else 'outbound_complete' end,
     completed_at=case when exists(select 1 from public.inventory_shipment_items x join public.inventory_item_fulfillments f on f.inventory_item_id=x.inventory_item_id where x.shipment_id=w.shipment_id and x.origin_store_id=w.origin_store_id and x.line_status not in ('excluded','cancelled') and not f.outbound_released) then null else clock_timestamp() end,
     completed_by=case when exists(select 1 from public.inventory_shipment_items x join public.inventory_item_fulfillments f on f.inventory_item_id=x.inventory_item_id where x.shipment_id=w.shipment_id and x.origin_store_id=w.origin_store_id and x.line_status not in ('excluded','cancelled') and not f.outbound_released) then null else v_actor end,
     version=version+1,updated_at=clock_timestamp()
   where w.shipment_id=v_case.shipment_id and w.origin_store_id=v_i.origin_store_id and w.status<>'cancelled';
   perform app_private.refresh_inventory_shipment_status(v_case.shipment_id,gen_random_uuid());
 end if;
 insert into public.inventory_exception_events(case_id,sequence_no,event_type,actor_user_id,idempotency_key,metadata) values(v_case.id,coalesce((select max(sequence_no)+1 from public.inventory_exception_events where case_id=v_case.id),1),'resolved',v_actor,p_idempotency_key,jsonb_build_object('resolution',p_resolution));
 insert into public.inventory_item_fulfillment_events(inventory_item_id,sequence_no,event_type,from_stage,to_stage,from_location_kind,to_location_kind,actor_kind,actor_user_id,idempotency_key,reason_code,note) values(v_i.id,coalesce((select max(sequence_no)+1 from public.inventory_item_fulfillment_events where inventory_item_id=v_i.id),1),'exception_resolved',v_f.current_stage,v_f.current_stage,v_f.location_kind,v_f.location_kind,'user',v_actor,p_idempotency_key,p_resolution,p_public_reason);
 v_result:=jsonb_build_object('id',v_case.id,'version',v_case.version,'status',v_case.status,'resolution',p_resolution,'refundId',v_refund,'idempotent_replay',false); insert into public.inventory_command_receipts values(v_actor,p_idempotency_key,'resolve_exception',v_case.id,v_fp,v_result,clock_timestamp()); return v_result;
end; $$;

create or replace function public.submit_manual_refund_account(
 p_refund_id uuid,p_ciphertext text,p_initialization_vector text,p_authentication_tag text,p_key_version integer,p_fingerprint text,p_masked_account_number text,p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_ref public.manual_refunds%rowtype; v_acc public.manual_refund_accounts%rowtype; v_fp text; v_r public.inventory_command_receipts%rowtype; v_result jsonb; v_now timestamptz:=clock_timestamp();
begin
 if v_actor is null or p_idempotency_key is null or p_key_version not between 1 and 1000000 or lower(coalesce(p_fingerprint,'')) !~ '^[0-9a-f]{64}$' or coalesce(p_masked_account_number,'') !~ '^\*{4}[0-9]{4}$' then raise exception using errcode='22023',message='환불 계좌 암호문 메타데이터를 확인해 주세요.'; end if;
 begin
   if octet_length(decode(p_ciphertext,'base64')) not between 16 and 4096 or octet_length(decode(p_initialization_vector,'base64')) not between 12 and 32 or octet_length(decode(p_authentication_tag,'base64')) not between 12 and 32 then raise exception using errcode='22023',message='환불 계좌 암호문 길이가 올바르지 않습니다.'; end if;
 exception when invalid_parameter_value then raise exception using errcode='22023',message='환불 계좌 암호문은 base64 형식이어야 합니다.'; end;
 v_fp:=app_private.inventory_v2_fingerprint(jsonb_build_object('refund',p_refund_id,'keyVersion',p_key_version,'fingerprint',lower(p_fingerprint),'masked',p_masked_account_number));
 select * into v_r from public.inventory_command_receipts where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
 if found then if v_r.command_name<>'submit_refund_account' or v_r.request_fingerprint<>v_fp then raise exception using errcode='23505',message='동일한 요청 키를 재사용할 수 없습니다.'; end if; return v_r.result||jsonb_build_object('idempotent_replay',true); end if;
 select * into v_ref from public.manual_refunds where id=p_refund_id for update;
 if not found or v_ref.member_id<>v_actor then raise exception using errcode='42501',message='본인의 환불 건만 계좌를 제출할 수 있습니다.'; end if;
 if v_ref.status<>'requested' then raise exception using errcode='55000',message='계좌를 제출할 수 있는 환불 상태가 아닙니다.'; end if;
 insert into public.manual_refund_accounts(refund_id,member_id,account_ciphertext,account_initialization_vector,account_authentication_tag,account_key_version,account_fingerprint,masked_account_number,account_submitted_at,account_expires_at)
 values(v_ref.id,v_actor,p_ciphertext,p_initialization_vector,p_authentication_tag,p_key_version,lower(p_fingerprint),p_masked_account_number,v_now,v_now+interval '30 days')
 on conflict(refund_id) do update set account_ciphertext=excluded.account_ciphertext,account_initialization_vector=excluded.account_initialization_vector,account_authentication_tag=excluded.account_authentication_tag,account_key_version=excluded.account_key_version,account_fingerprint=excluded.account_fingerprint,masked_account_number=excluded.masked_account_number,account_submitted_at=excluded.account_submitted_at,account_expires_at=excluded.account_expires_at,cleared_at=null,version=public.manual_refund_accounts.version+1,updated_at=v_now returning * into v_acc;
 update public.manual_refunds set version=version+1,updated_at=v_now where id=v_ref.id returning * into v_ref;
 insert into public.manual_refund_events(refund_id,sequence_no,event_type,actor_user_id,idempotency_key,metadata) values(v_ref.id,coalesce((select max(sequence_no)+1 from public.manual_refund_events where refund_id=v_ref.id),1),'account_submitted',v_actor,p_idempotency_key,jsonb_build_object('keyVersion',p_key_version,'expiresAt',v_acc.account_expires_at));
 v_result:=jsonb_build_object('refund_id',v_ref.id,'id',v_ref.id,'status',v_ref.status,'version',v_ref.version,'account_expires_at',v_acc.account_expires_at,'idempotent_replay',false); insert into public.inventory_command_receipts values(v_actor,p_idempotency_key,'submit_refund_account',v_ref.id,v_fp,v_result,v_now); return v_result;
end; $$;

create or replace function public.get_my_manual_refunds()
returns jsonb language sql stable security definer set search_path = '' as $$
select jsonb_build_object(
 'refunds',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'refundKind','item','inventoryItemId',r.inventory_item_id,'productId',i.product_id,'title',p.title,'status',r.status,'amount',r.amount,'accountSubmitted',(a.refund_id is not null),'accountExpiresAt',a.account_expires_at,'approvedAt',r.approved_at,'completedAt',r.completed_at,'publicReason',e.public_reason) order by r.created_at desc,r.id) from public.manual_refunds r join public.customer_inventory_items i on i.id=r.inventory_item_id join public.products p on p.id=i.product_id join public.inventory_exception_cases e on e.id=r.exception_case_id left join public.manual_refund_accounts a on a.refund_id=r.id where r.member_id=auth.uid()),'[]'::jsonb),
 'shippingFeeRefunds',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'refundKind','shipping_fee','shipmentId',r.inventory_shipment_id,'status',r.status,'amount',r.amount,'accountSubmitted',(a.shipping_fee_refund_id is not null),'accountExpiresAt',a.account_expires_at,'createdAt',r.created_at) order by r.created_at desc,r.id) from public.shipping_fee_refunds r left join public.shipping_fee_refund_accounts a on a.shipping_fee_refund_id=r.id where r.member_id=auth.uid()),'[]'::jsonb)
);
$$;

create or replace function public.submit_shipping_fee_refund_account(p_refund_id uuid,p_ciphertext text,p_initialization_vector text,p_authentication_tag text,p_key_version integer,p_fingerprint text,p_masked_account_number text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_ref public.shipping_fee_refunds%rowtype; v_acc public.shipping_fee_refund_accounts%rowtype; v_fp text; v_r public.inventory_command_receipts%rowtype; v_result jsonb; v_now timestamptz:=clock_timestamp();
begin
 if v_actor is null or p_idempotency_key is null or p_key_version not between 1 and 1000000 or lower(coalesce(p_fingerprint,''))!~'^[0-9a-f]{64}$' or coalesce(p_masked_account_number,'')!~'^\*{4}[0-9]{4}$' then raise exception using errcode='22023',message='환불 계좌 암호문 메타데이터를 확인해 주세요.'; end if;
 begin if octet_length(decode(p_ciphertext,'base64')) not between 16 and 4096 or octet_length(decode(p_initialization_vector,'base64')) not between 12 and 32 or octet_length(decode(p_authentication_tag,'base64')) not between 12 and 32 then raise exception using errcode='22023',message='환불 계좌 암호문 길이가 올바르지 않습니다.'; end if; exception when invalid_parameter_value then raise exception using errcode='22023',message='환불 계좌 암호문은 base64 형식이어야 합니다.'; end;
 v_fp:=app_private.inventory_v2_fingerprint(jsonb_build_object('refund',p_refund_id,'keyVersion',p_key_version,'fingerprint',lower(p_fingerprint),'masked',p_masked_account_number)); select * into v_r from public.inventory_command_receipts where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
 if found then if v_r.command_name<>'submit_shipping_fee_refund_account' or v_r.request_fingerprint<>v_fp then raise exception using errcode='23505',message='동일한 요청 키를 재사용할 수 없습니다.'; end if; return v_r.result||jsonb_build_object('idempotent_replay',true); end if;
 select * into v_ref from public.shipping_fee_refunds where id=p_refund_id for update; if not found or v_ref.member_id<>v_actor or v_ref.status<>'requested' then raise exception using errcode='42501',message='제출 가능한 본인 배송비 환불 건이 아닙니다.'; end if;
 insert into public.shipping_fee_refund_accounts(shipping_fee_refund_id,member_id,account_ciphertext,account_initialization_vector,account_authentication_tag,account_key_version,account_fingerprint,masked_account_number,account_submitted_at,account_expires_at,version) values(v_ref.id,v_actor,p_ciphertext,p_initialization_vector,p_authentication_tag,p_key_version,lower(p_fingerprint),p_masked_account_number,v_now,v_now+interval '30 days',0) on conflict(shipping_fee_refund_id) do update set account_ciphertext=excluded.account_ciphertext,account_initialization_vector=excluded.account_initialization_vector,account_authentication_tag=excluded.account_authentication_tag,account_key_version=excluded.account_key_version,account_fingerprint=excluded.account_fingerprint,masked_account_number=excluded.masked_account_number,account_submitted_at=excluded.account_submitted_at,account_expires_at=excluded.account_expires_at,version=public.shipping_fee_refund_accounts.version+1 returning * into v_acc;
 update public.shipping_fee_refunds set version=version+1 where id=v_ref.id returning * into v_ref;
 insert into public.shipping_fee_refund_events(shipping_fee_refund_id,sequence_no,event_type,actor_user_id,idempotency_key,metadata) values(v_ref.id,coalesce((select max(sequence_no)+1 from public.shipping_fee_refund_events where shipping_fee_refund_id=v_ref.id),1),'account_submitted',v_actor,p_idempotency_key,jsonb_build_object('keyVersion',p_key_version,'expiresAt',v_acc.account_expires_at));
 v_result:=jsonb_build_object('refund_id',v_ref.id,'id',v_ref.id,'version',v_ref.version,'status',v_ref.status,'account_expires_at',v_acc.account_expires_at,'idempotent_replay',false); insert into public.inventory_command_receipts values(v_actor,p_idempotency_key,'submit_shipping_fee_refund_account',v_ref.id,v_fp,v_result,v_now); return v_result;
end; $$;

create or replace function public.record_shipping_fee_refund_account_access(p_refund_id uuid,p_reason text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_ref public.shipping_fee_refunds%rowtype; v_fp text; v_r public.inventory_command_receipts%rowtype; v_event uuid; v_result jsonb;
begin
 if v_actor is null or not public.is_owner() then raise exception using errcode='42501',message='Owner 권한이 필요합니다.'; end if;
 if p_idempotency_key is null or char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception using errcode='22023',message='계좌 열람 사유를 입력해 주세요.'; end if;
 v_fp:=app_private.inventory_v2_fingerprint(jsonb_build_object('refund',p_refund_id,'reason',btrim(p_reason))); select * into v_r from public.inventory_command_receipts where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
 if found then if v_r.command_name<>'shipping_fee_refund_account_access' or v_r.request_fingerprint<>v_fp then raise exception using errcode='23505',message='동일한 요청 키를 재사용할 수 없습니다.'; end if; return v_r.result||jsonb_build_object('idempotent_replay',true); end if;
 select * into v_ref from public.shipping_fee_refunds where id=p_refund_id for update; if not found or not exists(select 1 from public.shipping_fee_refund_accounts where shipping_fee_refund_id=p_refund_id and account_expires_at>clock_timestamp()) then raise exception using errcode='55000',message='열람 가능한 배송비 환불 계좌가 없습니다.'; end if;
 insert into public.shipping_fee_refund_events(shipping_fee_refund_id,sequence_no,event_type,actor_user_id,idempotency_key,metadata) values(v_ref.id,coalesce((select max(sequence_no)+1 from public.shipping_fee_refund_events where shipping_fee_refund_id=v_ref.id),1),'account_accessed',v_actor,p_idempotency_key,jsonb_build_object('reason',btrim(p_reason))) returning id into v_event;
 v_result:=jsonb_build_object('refund_id',v_ref.id,'id',v_ref.id,'version',v_ref.version,'status',v_ref.status,'account_access_event_id',v_event,'idempotent_replay',false); insert into public.inventory_command_receipts values(v_actor,p_idempotency_key,'shipping_fee_refund_account_access',v_ref.id,v_fp,v_result,clock_timestamp()); return v_result;
end; $$;

create or replace function public.get_manual_refund_queue(p_include_completed boolean default false,p_limit integer default 100,p_offset integer default 0)
returns jsonb language sql stable security definer set search_path = '' as $$
select case when auth.uid() is null or not public.is_owner() then jsonb_build_object('refunds','[]'::jsonb) else jsonb_build_object('refunds',coalesce(jsonb_agg(jsonb_build_object('id',r.id,'inventoryItemId',r.inventory_item_id,'memberId',r.member_id,'productId',i.product_id,'title',p.title,'originStoreId',r.origin_store_id,'originStoreName',s.name,'status',r.status,'amount',r.amount,'maskedAccountNumber',a.masked_account_number,'accountSubmittedAt',a.account_submitted_at,'accountExpiresAt',a.account_expires_at,'approvedAt',r.approved_at,'completedAt',r.completed_at,'externalReference',r.transfer_reference,'version',r.version) order by r.created_at,r.id),'[]'::jsonb)) end
from (select * from public.manual_refunds where p_include_completed or status not in ('completed','cancelled') order by created_at,id limit greatest(1,least(coalesce(p_limit,100),500)) offset greatest(coalesce(p_offset,0),0)) r join public.customer_inventory_items i on i.id=r.inventory_item_id join public.products p on p.id=i.product_id join public.stores s on s.id=r.origin_store_id left join public.manual_refund_accounts a on a.refund_id=r.id;
$$;

create or replace function public.record_manual_refund_account_access(p_refund_id uuid,p_reason text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_ref public.manual_refunds%rowtype; v_fp text; v_r public.inventory_command_receipts%rowtype; v_event uuid; v_result jsonb;
begin
 if v_actor is null or not public.is_owner() then raise exception using errcode='42501',message='Owner 권한이 필요합니다.'; end if;
 if p_idempotency_key is null or char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception using errcode='22023',message='계좌 열람 사유를 입력해 주세요.'; end if;
 v_fp:=app_private.inventory_v2_fingerprint(jsonb_build_object('refund',p_refund_id,'reason',btrim(p_reason))); select * into v_r from public.inventory_command_receipts where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
 if found then if v_r.command_name<>'refund_account_access' or v_r.request_fingerprint<>v_fp then raise exception using errcode='23505',message='동일한 요청 키를 재사용할 수 없습니다.'; end if; return v_r.result||jsonb_build_object('idempotent_replay',true); end if;
 select * into v_ref from public.manual_refunds where id=p_refund_id for update; if not found or not exists(select 1 from public.manual_refund_accounts where refund_id=p_refund_id and cleared_at is null and account_expires_at>clock_timestamp()) then raise exception using errcode='55000',message='열람 가능한 환불 계좌가 없습니다.'; end if;
 insert into public.manual_refund_events(refund_id,sequence_no,event_type,actor_user_id,idempotency_key,metadata) values(v_ref.id,coalesce((select max(sequence_no)+1 from public.manual_refund_events where refund_id=v_ref.id),1),'account_accessed',v_actor,p_idempotency_key,jsonb_build_object('reason',btrim(p_reason))) returning id into v_event;
 v_result:=jsonb_build_object('refund_id',v_ref.id,'id',v_ref.id,'version',v_ref.version,'status',v_ref.status,'account_access_event_id',v_event,'idempotent_replay',false); insert into public.inventory_command_receipts values(v_actor,p_idempotency_key,'refund_account_access',v_ref.id,v_fp,v_result,clock_timestamp()); return v_result;
end; $$;

create or replace function public.review_manual_refund(p_refund_id uuid,p_expected_version bigint,p_action text,p_external_reference text,p_note text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_ref public.manual_refunds%rowtype; v_i public.customer_inventory_items%rowtype; v_f public.inventory_item_fulfillments%rowtype; v_case public.inventory_exception_cases%rowtype; v_fp text; v_r public.inventory_command_receipts%rowtype; v_result jsonb; v_now timestamptz:=clock_timestamp();
begin
 if v_actor is null or not public.is_owner() then raise exception using errcode='42501',message='Owner 권한이 필요합니다.'; end if;
 if p_action not in ('approve','complete','cancel') or p_idempotency_key is null then raise exception using errcode='22023',message='환불 검토 입력값을 확인해 주세요.'; end if;
 v_fp:=app_private.inventory_v2_fingerprint(jsonb_build_object('refund',p_refund_id,'version',p_expected_version,'action',p_action,'reference',btrim(coalesce(p_external_reference,'')),'note',btrim(coalesce(p_note,'')))); select * into v_r from public.inventory_command_receipts where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
 if found then if v_r.command_name<>'review_refund' or v_r.request_fingerprint<>v_fp then raise exception using errcode='23505',message='동일한 요청 키를 재사용할 수 없습니다.'; end if; return v_r.result||jsonb_build_object('idempotent_replay',true); end if;
 select * into v_ref from public.manual_refunds where id=p_refund_id for update; if not found then raise exception using errcode='P0002',message='환불 건을 찾지 못했습니다.'; end if;
 if v_ref.version<>p_expected_version then raise exception using errcode='PT409',message='환불 상태가 변경되었습니다.'; end if;
 select * into v_i from public.customer_inventory_items where id=v_ref.inventory_item_id for update; select * into v_f from public.inventory_item_fulfillments where inventory_item_id=v_ref.inventory_item_id for update; select * into v_case from public.inventory_exception_cases where id=v_ref.exception_case_id;
 if p_action='approve' then
   if v_ref.status<>'requested' or not exists(select 1 from public.manual_refund_accounts where refund_id=v_ref.id and cleared_at is null and account_expires_at>v_now) then raise exception using errcode='55000',message='유효한 환불 계좌 제출 후 승인할 수 있습니다.'; end if;
   update public.manual_refunds set status='approved',approved_by=v_actor,approved_at=v_now,version=version+1,updated_at=v_now where id=v_ref.id returning * into v_ref;
 elsif p_action='complete' then
   if v_ref.status<>'approved' or nullif(btrim(coalesce(p_external_reference,'')),'') is null then raise exception using errcode='55000',message='승인된 환불에 송금 참조값을 입력해 주세요.'; end if;
   insert into public.manual_refund_disbursements(refund_id,business_id,origin_store_id,amount,external_reference,disbursed_by,disbursed_at,idempotency_key) values(v_ref.id,v_ref.business_id,v_ref.origin_store_id,v_ref.amount,btrim(p_external_reference),v_actor,v_now,p_idempotency_key);
   update public.manual_refunds set status='completed',completed_by=v_actor,completed_at=v_now,transfer_reference=btrim(p_external_reference),version=version+1,updated_at=v_now where id=v_ref.id returning * into v_ref;
   update public.customer_inventory_items set ownership_status='refunded',version=version+1 where id=v_i.id;
   update public.inventory_item_fulfillments set current_stage='cancelled',location_kind='unknown',storage_location_code=null,is_blocked=false,block_reason=null,version=version+1,last_event_at=v_now,updated_at=v_now where inventory_item_id=v_i.id;
   delete from public.manual_refund_accounts where refund_id=v_ref.id;
   insert into public.store_financial_entries(business_id,origin_store_id,inventory_item_id,manual_refund_id,entry_kind,amount,occurred_at,idempotency_key,metadata) values(v_ref.business_id,v_ref.origin_store_id,v_ref.inventory_item_id,v_ref.id,'item_refund',-v_ref.amount,v_now,p_idempotency_key,jsonb_build_object('externalReference',btrim(p_external_reference)));
   if v_i.commerce_order_item_id is not null then update public.commerce_orders o set status=case when exists(select 1 from public.commerce_order_items oi join public.customer_inventory_items ci on ci.commerce_order_item_id=oi.id where oi.order_id=o.id and ci.ownership_status<>'refunded') then 'partially_refunded' else 'refunded' end,updated_at=v_now where o.id=(select order_id from public.commerce_order_items where id=v_i.commerce_order_item_id); end if;
 else
   if v_ref.status not in ('requested','approved') then raise exception using errcode='55000',message='취소할 수 있는 환불 상태가 아닙니다.'; end if;
   update public.manual_refunds set status='cancelled',cancelled_by=v_actor,cancelled_at=v_now,version=version+1,updated_at=v_now where id=v_ref.id returning * into v_ref;
   update public.customer_inventory_items set ownership_status='active',version=version+1 where id=v_i.id;
   update public.inventory_item_fulfillments set is_blocked=false,block_reason=null,version=version+1,updated_at=v_now where inventory_item_id=v_i.id;
   delete from public.manual_refund_accounts where refund_id=v_ref.id;
 end if;
 insert into public.manual_refund_events(refund_id,sequence_no,event_type,actor_user_id,idempotency_key,metadata) values(v_ref.id,coalesce((select max(sequence_no)+1 from public.manual_refund_events where refund_id=v_ref.id),1),case p_action when 'approve' then 'approved' when 'complete' then 'completed' else 'cancelled' end,v_actor,p_idempotency_key,jsonb_build_object('externalReference',nullif(btrim(coalesce(p_external_reference,'')),''),'note',nullif(btrim(coalesce(p_note,'')),'')));
 if p_action='complete' then insert into public.inventory_item_fulfillment_events(inventory_item_id,sequence_no,event_type,from_stage,to_stage,from_location_kind,to_location_kind,actor_kind,actor_user_id,idempotency_key,reason_code,note) values(v_i.id,coalesce((select max(sequence_no)+1 from public.inventory_item_fulfillment_events where inventory_item_id=v_i.id),1),'refund_completed',v_f.current_stage,'cancelled',v_f.location_kind,'unknown','user',v_actor,p_idempotency_key,'manual_refund',p_note); end if;
 v_result:=jsonb_build_object('refund_id',v_ref.id,'id',v_ref.id,'version',v_ref.version,'status',v_ref.status,'idempotent_replay',false); insert into public.inventory_command_receipts values(v_actor,p_idempotency_key,'review_refund',v_ref.id,v_fp,v_result,v_now); return v_result;
end; $$;

create or replace function public.get_store_financial_report(p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz; v_to timestamptz; v_result jsonb;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='매출 조회 권한이 필요합니다.'; end if;
 if p_from is null or p_to is null or p_to<p_from or (p_to-p_from)>365 then raise exception using errcode='22023',message='조회 기간은 최대 366일까지 선택할 수 있습니다.'; end if;
 v_from:=p_from::timestamp at time zone 'Asia/Seoul'; v_to:=(p_to+1)::timestamp at time zone 'Asia/Seoul';
 select jsonb_build_object(
   'stores',coalesce(jsonb_agg(jsonb_build_object('storeId',q.store_id,'storeName',q.store_name,'grossSales',q.gross_sales,'refunds',q.refunds,'netSales',q.gross_sales-q.refunds,'paidItemCount',q.paid_count,'refundedItemCount',q.refunded_count,'entries',q.entries) order by q.store_name,q.store_id),'[]'::jsonb),
   'centralShippingFees',coalesce((select sum(e.amount) from public.store_financial_entries e where e.entry_kind in ('shipping_fee','shipping_fee_refund') and e.occurred_at>=v_from and e.occurred_at<v_to and (public.is_owner() or public.has_business_permission(e.business_id,'view_reports'))),0),
   'serverTime',clock_timestamp()) into v_result
 from (
  select s.id store_id,s.name store_name,
    coalesce(sum(e.amount) filter(where e.entry_kind='item_payment'),0) gross_sales,
    coalesce(-sum(e.amount) filter(where e.entry_kind in ('item_refund','payment_reversal')),0) refunds,
    count(e.id) filter(where e.entry_kind='item_payment')::integer paid_count,
    count(e.id) filter(where e.entry_kind in ('item_refund','payment_reversal'))::integer refunded_count,
    coalesce(jsonb_agg(jsonb_build_object('id',e.id,'entryKind',e.entry_kind,'amount',e.amount,'occurredAt',e.occurred_at,'inventoryItemId',e.inventory_item_id,'manualRefundId',e.manual_refund_id) order by e.occurred_at,e.id) filter(where e.id is not null),'[]'::jsonb) entries
  from public.stores s left join public.store_financial_entries e on e.origin_store_id=s.id and e.occurred_at>=v_from and e.occurred_at<v_to and e.entry_kind in ('item_payment','payment_reversal','item_refund')
  where public.is_owner() or public.has_store_permission(s.id,'view_reports') group by s.id,s.name
 )q;
 return coalesce(v_result,jsonb_build_object('stores','[]'::jsonb,'centralShippingFees',0,'serverTime',clock_timestamp()));
end; $$;

create or replace function public.get_shipping_fee_refund_queue(p_include_completed boolean default false,p_limit integer default 100,p_offset integer default 0)
returns jsonb language sql stable security definer set search_path = '' as $$
select case when auth.uid() is null or not public.is_owner() then jsonb_build_object('refunds','[]'::jsonb) else jsonb_build_object('refunds',coalesce(jsonb_agg(jsonb_build_object('id',r.id,'refundKind','shipping_fee','shipmentId',r.inventory_shipment_id,'paymentId',r.shipping_fee_payment_id,'memberId',r.member_id,'businessId',r.business_id,'amount',r.amount,'status',r.status,'version',r.version,'createdAt',r.created_at,'externalReference',d.external_reference,'accountSubmitted',(a.shipping_fee_refund_id is not null),'accountSubmittedAt',a.account_submitted_at,'accountExpiresAt',a.account_expires_at,'maskedAccountNumber',a.masked_account_number) order by r.created_at,r.id),'[]'::jsonb)) end
from (select * from public.shipping_fee_refunds where p_include_completed or status='requested' order by created_at,id limit greatest(1,least(coalesce(p_limit,100),500)) offset greatest(coalesce(p_offset,0),0))r left join public.shipping_fee_refund_disbursements d on d.shipping_fee_refund_id=r.id left join public.shipping_fee_refund_accounts a on a.shipping_fee_refund_id=r.id;
$$;

create or replace function public.review_shipping_fee_refund(p_refund_id uuid,p_expected_version bigint,p_action text,p_external_reference text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_ref public.shipping_fee_refunds%rowtype; v_ledger public.manual_transfer_payment_ledger%rowtype; v_fp text; v_r public.inventory_command_receipts%rowtype; v_result jsonb;
begin
 if v_actor is null or not public.is_owner() then raise exception using errcode='42501',message='Owner 권한이 필요합니다.'; end if;
 if p_action<>'complete' or p_idempotency_key is null or char_length(btrim(coalesce(p_external_reference,''))) not between 3 and 200 then raise exception using errcode='22023',message='배송비 환불 처리값을 확인해 주세요.'; end if;
 v_fp:=app_private.inventory_v2_fingerprint(jsonb_build_object('refund',p_refund_id,'version',p_expected_version,'action',p_action,'reference',btrim(coalesce(p_external_reference,'')))); select * into v_r from public.inventory_command_receipts where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
 if found then if v_r.command_name<>'review_shipping_fee_refund' or v_r.request_fingerprint<>v_fp then raise exception using errcode='23505',message='동일한 요청 키를 재사용할 수 없습니다.'; end if; return v_r.result||jsonb_build_object('idempotent_replay',true); end if;
 select * into v_ref from public.shipping_fee_refunds where id=p_refund_id for update; if not found then raise exception using errcode='P0002',message='배송비 환불 건을 찾지 못했습니다.'; end if;
 if v_ref.status<>'requested' or v_ref.version<>p_expected_version then raise exception using errcode='PT409',message='배송비 환불 상태가 변경되었습니다.'; end if;
 if not exists(select 1 from public.shipping_fee_refund_accounts where shipping_fee_refund_id=v_ref.id and account_expires_at>clock_timestamp()) then raise exception using errcode='55000',message='유효한 환불 계좌 제출 후 완료할 수 있습니다.'; end if;
 select * into v_ledger from public.manual_transfer_payment_ledger where shipping_fee_payment_id=v_ref.shipping_fee_payment_id and entry_type='receipt' order by created_at,id limit 1 for update;
 if not found then raise exception using errcode='23514',message='배송비 입금 원장을 찾지 못했습니다.'; end if;
 insert into public.shipping_fee_refund_disbursements(shipping_fee_refund_id,external_reference,amount,disbursed_by,idempotency_key) values(v_ref.id,btrim(p_external_reference),v_ref.amount,v_actor,p_idempotency_key);
 insert into public.manual_transfer_payment_ledger(transfer_kind,shipping_fee_payment_id,entry_type,amount,memo,reversal_of,recorded_by,idempotency_key) values('shipping',v_ref.shipping_fee_payment_id,'reversal',v_ref.amount,'shipping fee refund',v_ledger.id,v_actor,p_idempotency_key::text);
 update public.shipping_fee_payments set status='cancelled' where id=v_ref.shipping_fee_payment_id;
 update public.shipping_fee_refunds set status='completed',version=version+1 where id=v_ref.id returning * into v_ref;
 insert into public.store_financial_entries(business_id,inventory_shipment_id,entry_kind,amount,occurred_at,idempotency_key,metadata) values(v_ref.business_id,v_ref.inventory_shipment_id,'shipping_fee_refund',-v_ref.amount,clock_timestamp(),p_idempotency_key,jsonb_build_object('shippingFeeRefundId',v_ref.id));
 delete from public.shipping_fee_refund_accounts where shipping_fee_refund_id=v_ref.id;
 insert into public.shipping_fee_refund_events(shipping_fee_refund_id,sequence_no,event_type,actor_user_id,idempotency_key,metadata)
 values(v_ref.id,coalesce((select max(sequence_no)+1 from public.shipping_fee_refund_events where shipping_fee_refund_id=v_ref.id),1),'completed',v_actor,p_idempotency_key,jsonb_build_object('externalReference',btrim(p_external_reference)));
 v_result:=jsonb_build_object('refund_id',v_ref.id,'id',v_ref.id,'version',v_ref.version,'status',v_ref.status,'idempotent_replay',false); insert into public.inventory_command_receipts values(v_actor,p_idempotency_key,'review_shipping_fee_refund',v_ref.id,v_fp,v_result,clock_timestamp()); return v_result;
end; $$;

create or replace function app_private.clear_expired_manual_refund_accounts()
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_count bigint; v_fee_count bigint;
begin
 delete from public.manual_refund_accounts where account_expires_at<=clock_timestamp();
 get diagnostics v_count=row_count;
 delete from public.shipping_fee_refund_accounts where account_expires_at<=clock_timestamp();
 get diagnostics v_fee_count=row_count;
 return v_count+v_fee_count;
end; $$;

do $$ declare v_job bigint; begin
 select jobid into v_job from cron.job where jobname='clear-expired-manual-refund-accounts' limit 1;
 if v_job is not null then perform cron.unschedule(v_job); end if;
 perform cron.schedule('clear-expired-manual-refund-accounts','17 * * * *',$job$select app_private.clear_expired_manual_refund_accounts();$job$);
end; $$;

create or replace function app_private.reject_inventory_paid_source_reversal()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_is_reversal boolean := false;
  v_item public.customer_inventory_items%rowtype;
  v_fulfillment public.inventory_item_fulfillments%rowtype;
  v_event_key uuid := gen_random_uuid();
begin
  if tg_table_name = 'commerce_order_items' then
    v_is_reversal := old.payment_status = 'paid' and new.payment_status <> 'paid';
    if v_is_reversal then
      select * into v_item from public.customer_inventory_items
      where commerce_order_item_id = old.id for update;
    end if;
  elsif tg_table_name = 'manual_transfer_orders' then
    v_is_reversal := old.status = 'confirmed' and new.status <> 'confirmed';
    if v_is_reversal then
      select * into v_item from public.customer_inventory_items
      where manual_transfer_order_id = old.id for update;
    end if;
  elsif tg_table_name = 'payment_orders' then
    v_is_reversal := old.payment_status = '결제완료'
      and old.portone_status = 'PAID'
      and (new.payment_status <> '결제완료' or new.portone_status <> 'PAID');
    if v_is_reversal then
      select * into v_item from public.customer_inventory_items
      where legacy_payment_order_id = old.id for update;
    end if;
  end if;

  if not v_is_reversal or v_item.id is null then
    return new;
  end if;

  select * into v_fulfillment from public.inventory_item_fulfillments
  where inventory_item_id = v_item.id for update;
  if v_item.ownership_status <> 'active'
    or v_fulfillment.current_stage <> 'entitled'
    or v_fulfillment.outbound_released
    or v_fulfillment.is_blocked
    or exists (
      select 1 from public.inventory_shipment_items x
      where x.inventory_item_id = v_item.id
        and x.line_status in ('requested','held','ready','packed')
    )
    or exists (
      select 1 from public.inventory_exception_cases e
      where e.inventory_item_id = v_item.id and e.status = 'open'
    )
  then
    raise exception using errcode='55000',message='이동 또는 예외 처리가 시작된 보관 소유권은 결제 원천에서 되돌릴 수 없습니다. 수동 환불 절차를 사용해 주세요.';
  end if;

  insert into public.inventory_item_fulfillment_events (
    inventory_item_id, sequence_no, event_type, from_stage, to_stage,
    from_location_kind, to_location_kind, actor_kind, idempotency_key,
    reason_code, metadata
  ) values (
    v_item.id,
    coalesce((select max(sequence_no)+1 from public.inventory_item_fulfillment_events where inventory_item_id=v_item.id),1),
    'cancelled', v_fulfillment.current_stage, 'cancelled',
    v_fulfillment.location_kind, 'unknown', 'system', v_event_key,
    'payment_source_reversed',
    jsonb_build_object('sourceKind',v_item.source_kind)
  );
  update public.customer_inventory_items
  set ownership_status='cancelled',version=version+1
  where id=v_item.id;
  update public.inventory_item_fulfillments
  set current_stage='cancelled',location_kind='unknown',storage_location_code=null,
      outbound_released=false,is_blocked=false,block_reason=null,
      version=version+1,last_event_at=clock_timestamp(),updated_at=clock_timestamp()
  where inventory_item_id=v_item.id;
  insert into public.store_financial_entries (
    business_id,origin_store_id,inventory_item_id,entry_kind,amount,
    occurred_at,idempotency_key,metadata
  ) values (
    v_item.business_id,v_item.origin_store_id,v_item.id,'payment_reversal',
    -v_item.paid_amount,clock_timestamp(),gen_random_uuid(),
    jsonb_build_object('sourceKind',v_item.source_kind,'reason','payment_source_reversed')
  );
  return new;
end; $$;

create trigger commerce_order_items_reject_inventory_reversal before update of payment_status on public.commerce_order_items for each row execute function app_private.reject_inventory_paid_source_reversal();
create trigger manual_transfer_orders_reject_inventory_reversal before update of status on public.manual_transfer_orders for each row execute function app_private.reject_inventory_paid_source_reversal();
create trigger payment_orders_reject_inventory_reversal before update of payment_status,portone_status on public.payment_orders for each row execute function app_private.reject_inventory_paid_source_reversal();

-- RPC-only access. The only direct-table exception is service_role SELECT on
-- encrypted account rows after the corresponding audited access RPC succeeds.
alter table public.store_fulfillment_routes enable row level security; alter table public.store_fulfillment_routes force row level security;
alter table public.store_fulfillment_route_events enable row level security; alter table public.store_fulfillment_route_events force row level security;
alter table public.fulfillment_center_staff_assignments enable row level security; alter table public.fulfillment_center_staff_assignments force row level security;
alter table public.inventory_fulfillment_rollout_settings enable row level security; alter table public.inventory_fulfillment_rollout_settings force row level security;
alter table public.inventory_command_receipts enable row level security; alter table public.inventory_command_receipts force row level security;
alter table public.customer_inventory_items enable row level security; alter table public.customer_inventory_items force row level security;
alter table public.inventory_item_fulfillments enable row level security; alter table public.inventory_item_fulfillments force row level security;
alter table public.inventory_item_fulfillment_events enable row level security; alter table public.inventory_item_fulfillment_events force row level security;
alter table public.inventory_shipments enable row level security; alter table public.inventory_shipments force row level security;
alter table public.inventory_shipment_items enable row level security; alter table public.inventory_shipment_items force row level security;
alter table public.inventory_shipment_store_works enable row level security; alter table public.inventory_shipment_store_works force row level security;
alter table public.inventory_shipment_events enable row level security; alter table public.inventory_shipment_events force row level security;
alter table public.inventory_exception_cases enable row level security; alter table public.inventory_exception_cases force row level security;
alter table public.inventory_exception_events enable row level security; alter table public.inventory_exception_events force row level security;
alter table public.manual_refunds enable row level security; alter table public.manual_refunds force row level security;
alter table public.manual_refund_accounts enable row level security; alter table public.manual_refund_accounts force row level security;
alter table public.manual_refund_events enable row level security; alter table public.manual_refund_events force row level security;
alter table public.manual_refund_disbursements enable row level security; alter table public.manual_refund_disbursements force row level security;
alter table public.shipping_fee_refunds enable row level security; alter table public.shipping_fee_refunds force row level security;
alter table public.shipping_fee_refund_disbursements enable row level security; alter table public.shipping_fee_refund_disbursements force row level security;
alter table public.shipping_fee_refund_accounts enable row level security; alter table public.shipping_fee_refund_accounts force row level security;
alter table public.shipping_fee_refund_events enable row level security; alter table public.shipping_fee_refund_events force row level security;
alter table public.shipping_fee_waiver_entitlements enable row level security; alter table public.shipping_fee_waiver_entitlements force row level security;
alter table public.store_financial_entries enable row level security; alter table public.store_financial_entries force row level security;

revoke all on public.store_fulfillment_routes,public.store_fulfillment_route_events,public.fulfillment_center_staff_assignments,
 public.inventory_fulfillment_rollout_settings,public.inventory_command_receipts,
 public.customer_inventory_items,public.inventory_item_fulfillments,public.inventory_item_fulfillment_events,
 public.inventory_shipments,public.inventory_shipment_items,public.inventory_shipment_store_works,public.inventory_shipment_events,
 public.inventory_exception_cases,public.inventory_exception_events,public.manual_refunds,public.manual_refund_accounts,
 public.manual_refund_events,public.manual_refund_disbursements,public.shipping_fee_refunds,
 public.shipping_fee_refund_disbursements,public.shipping_fee_refund_accounts,public.shipping_fee_refund_events,
 public.shipping_fee_waiver_entitlements,public.store_financial_entries
from public,anon,authenticated,service_role;
grant select on public.manual_refund_accounts,public.shipping_fee_refund_accounts to service_role;

revoke all on function app_private.inventory_v2_fingerprint(jsonb),app_private.reject_inventory_v2_append_only_mutation(),
 app_private.has_center_permission(uuid,text),app_private.can_confirm_shared_payment(uuid),app_private.guard_inventory_item_snapshot(),
 app_private.bump_unified_payment_version(),app_private.create_customer_inventory_entitlement(text,uuid),
 app_private.link_legacy_commerce_shipment(),app_private.guard_legacy_commerce_shipment_rollout(),
 app_private.guard_legacy_commerce_shipment_runtime(),app_private.project_inventory_entitlement(),
 app_private.refresh_inventory_shipment_status(uuid,uuid),
 app_private.clear_expired_manual_refund_accounts(),app_private.reject_inventory_paid_source_reversal(),app_private.reject_portone_after_manual_settlement(),app_private.lock_inventory_shipment(uuid)
from public,anon,authenticated,service_role;

revoke all on function public.get_legacy_commerce_shipment_quote(uuid,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.get_legacy_commerce_shipment_quote(uuid,uuid)
to service_role;

revoke all on function public.configure_store_fulfillment_route(uuid,uuid,text,bigint,uuid,text),
 public.configure_inventory_fulfillment_rollout(uuid,boolean,boolean,boolean,bigint,bigint,uuid),
 public.configure_fulfillment_center_staff_assignment(uuid,uuid,boolean,boolean,text,bigint,uuid),
 public.get_owner_inventory_fulfillment_configuration(),public.get_inventory_operational_health(),public.get_owner_inventory_reconciliation_queue(integer,integer),public.reconcile_inventory_item_route(uuid,bigint,uuid,text),
 public.get_unified_manual_payment_queue(boolean,integer,integer),public.confirm_unified_manual_payment(text,uuid,bigint,text,bigint,integer,uuid),
 public.get_my_inventory_overview(),public.request_inventory_shipment(uuid[],uuid,text,bigint,text,text,uuid),
 public.get_inventory_store_work_queue(integer,integer),public.release_inventory_shipment_items(uuid,uuid[],bigint,uuid,text),
 public.get_paid_inventory_store_queue(integer,integer),public.release_paid_inventory_items(uuid[],bigint[],uuid,text),
 public.get_inventory_center_queue(integer,integer),public.record_inventory_center_items(text,uuid[],bigint[],text,uuid,text),
 public.get_inventory_shipment_queue(boolean,integer,integer),public.pack_inventory_shipment(uuid,bigint,uuid,text),
 public.ship_inventory_shipment(uuid,bigint,text,text,uuid,text),public.get_my_inventory_shipments(),
 public.get_inventory_exception_candidates(integer,integer),public.get_inventory_exception_queue(boolean,integer,integer),
 public.open_inventory_exception(uuid,text,text,text,timestamptz,uuid),public.append_inventory_exception_evidence(uuid,text,uuid),
 public.resolve_inventory_exception(uuid,bigint,text,text,text,uuid),
 public.submit_manual_refund_account(uuid,text,text,text,integer,text,text,uuid),public.get_my_manual_refunds(),
 public.submit_shipping_fee_refund_account(uuid,text,text,text,integer,text,text,uuid),
 public.record_shipping_fee_refund_account_access(uuid,text,uuid),
 public.get_manual_refund_queue(boolean,integer,integer),public.record_manual_refund_account_access(uuid,text,uuid),
 public.review_manual_refund(uuid,bigint,text,text,text,uuid),public.get_store_financial_report(date,date),
 public.get_shipping_fee_refund_queue(boolean,integer,integer),public.review_shipping_fee_refund(uuid,bigint,text,text,uuid)
from public,anon,authenticated,service_role;

grant execute on function public.configure_store_fulfillment_route(uuid,uuid,text,bigint,uuid,text),
 public.configure_inventory_fulfillment_rollout(uuid,boolean,boolean,boolean,bigint,bigint,uuid),
 public.configure_fulfillment_center_staff_assignment(uuid,uuid,boolean,boolean,text,bigint,uuid),
 public.get_owner_inventory_fulfillment_configuration(),public.get_inventory_operational_health(),public.get_owner_inventory_reconciliation_queue(integer,integer),public.reconcile_inventory_item_route(uuid,bigint,uuid,text),
 public.get_unified_manual_payment_queue(boolean,integer,integer),public.confirm_unified_manual_payment(text,uuid,bigint,text,bigint,integer,uuid),
 public.get_my_inventory_overview(),public.request_inventory_shipment(uuid[],uuid,text,bigint,text,text,uuid),
 public.get_inventory_store_work_queue(integer,integer),public.release_inventory_shipment_items(uuid,uuid[],bigint,uuid,text),
 public.get_paid_inventory_store_queue(integer,integer),public.release_paid_inventory_items(uuid[],bigint[],uuid,text),
 public.get_inventory_center_queue(integer,integer),public.record_inventory_center_items(text,uuid[],bigint[],text,uuid,text),
 public.get_inventory_shipment_queue(boolean,integer,integer),public.pack_inventory_shipment(uuid,bigint,uuid,text),
 public.ship_inventory_shipment(uuid,bigint,text,text,uuid,text),public.get_my_inventory_shipments(),
 public.get_inventory_exception_candidates(integer,integer),public.get_inventory_exception_queue(boolean,integer,integer),
 public.open_inventory_exception(uuid,text,text,text,timestamptz,uuid),public.append_inventory_exception_evidence(uuid,text,uuid),
 public.resolve_inventory_exception(uuid,bigint,text,text,text,uuid),
 public.submit_manual_refund_account(uuid,text,text,text,integer,text,text,uuid),public.get_my_manual_refunds(),
 public.submit_shipping_fee_refund_account(uuid,text,text,text,integer,text,text,uuid),
 public.record_shipping_fee_refund_account_access(uuid,text,uuid),
 public.get_manual_refund_queue(boolean,integer,integer),public.record_manual_refund_account_access(uuid,text,uuid),
 public.review_manual_refund(uuid,bigint,text,text,text,uuid),public.get_store_financial_report(date,date),
 public.get_shipping_fee_refund_queue(boolean,integer,integer),public.review_shipping_fee_refund(uuid,bigint,text,text,uuid)
to authenticated;

comment on table public.customer_inventory_items is 'Immutable paid-source ownership projection; storage timer starts only at first center_stored transition.';
comment on table public.manual_refund_accounts is 'Encrypted refund account material. Plaintext account/bank/holder fields are intentionally absent; service access must be preceded by an audited RPC.';
comment on table public.shipping_fee_refund_accounts is 'Encrypted shipping-fee refund account material. Direct service access must be preceded by an audited RPC.';
comment on function public.pack_inventory_shipment(uuid,bigint,uuid,text) is 'CAS packing gate. Raises exact Korean error when any active line is not released, stored, ready, and unblocked.';

commit;
