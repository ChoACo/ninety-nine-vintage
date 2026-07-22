begin;

set local lock_timeout = '5s';

-- The legacy shipping tables describe a member-selected product bundle. Keep
-- them as immutable compatibility intent/history and add a separate canonical
-- Shipment aggregate whose manifest is bound to complete commerce orders.
lock table
  public.commerce_orders,
  public.commerce_order_items,
  public.shipping_requests,
  public.shipping_request_items,
  public.shipping_fee_payments,
  public.shipping_credit_ledger,
  public.order_item_fulfillments,
  public.fulfillment_events,
  public.fulfillment_command_receipts
in share row exclusive mode;

alter table public.commerce_orders
  add constraint commerce_orders_id_member_id_key
  unique (id, member_id);

alter table public.commerce_order_items
  add constraint commerce_order_items_shipment_identity_key
  unique (id, order_id, product_id, store_id);

alter table public.shipping_requests
  add constraint shipping_requests_id_member_id_key
  unique (id, member_id);

alter table public.shipping_fee_payments
  add constraint shipping_fee_payments_shipment_identity_key
  unique (id, member_id, shipping_request_id),
  add constraint shipping_fee_payments_shipping_request_member_fkey
  foreign key (shipping_request_id, member_id)
  references public.shipping_requests (id, member_id)
  on delete restrict;

alter table public.shipping_credit_ledger
  add constraint shipping_credit_ledger_shipment_identity_key
  unique (id, member_id, shipping_request_id),
  add constraint shipping_credit_ledger_shipping_request_member_fkey
  foreign key (shipping_request_id, member_id)
  references public.shipping_requests (id, member_id)
  on delete restrict,
  add constraint shipping_credit_ledger_request_usage_check
  check (
    shipping_request_id is null
    or (reason = 'used' and delta = -1)
  );

create unique index shipping_fee_payments_one_request_idx
  on public.shipping_fee_payments (shipping_request_id)
  where shipping_request_id is not null;

create unique index shipping_credit_ledger_one_request_usage_idx
  on public.shipping_credit_ledger (shipping_request_id)
  where shipping_request_id is not null;

alter table public.order_item_fulfillments
  add constraint order_item_fulfillments_shipment_identity_key
  unique (
    order_item_id,
    order_id,
    store_id,
    business_id,
    fulfillment_center_id
  );

alter table public.fulfillment_command_receipts
  drop constraint fulfillment_command_receipts_command_name_check;
alter table public.fulfillment_command_receipts
  add constraint fulfillment_command_receipts_command_name_check
  check (command_name in (
    'configure_center',
    'mark_ready',
    'hand_over',
    'receive',
    'store',
    'report_issue',
    'resolve_issue',
    'request_shipment',
    'pack_shipment',
    'ship_shipment',
    'correct_tracking'
  ));

alter table public.order_item_fulfillments
  drop constraint order_item_fulfillments_current_stage_check,
  drop constraint order_item_fulfillments_stage_location_check;
alter table public.order_item_fulfillments
  add constraint order_item_fulfillments_current_stage_check
  check (current_stage in (
    'waiting_payment',
    'reconciliation_required',
    'preparing',
    'ready_for_transfer',
    'in_transit_to_center',
    'center_received',
    'center_stored',
    'packed',
    'shipped',
    'cancelled',
    'legacy_terminal'
  )),
  add constraint order_item_fulfillments_stage_location_check
  check (
    (
      current_stage in ('waiting_payment', 'preparing', 'ready_for_transfer')
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
      current_stage = 'packed'
      and location_kind = 'center'
      and storage_location_code is null
    )
    or (
      current_stage = 'shipped'
      and location_kind = 'transit'
      and storage_location_code is null
    )
    or (
      current_stage in ('reconciliation_required', 'cancelled', 'legacy_terminal')
      and location_kind = 'unknown'
      and storage_location_code is null
    )
  );

alter table public.fulfillment_events
  drop constraint fulfillment_events_event_type_check,
  drop constraint fulfillment_events_from_stage_check,
  drop constraint fulfillment_events_to_stage_check;
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
    'packed',
    'shipped',
    'cancelled'
  )),
  add constraint fulfillment_events_from_stage_check
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
      'packed',
      'shipped',
      'cancelled',
      'legacy_terminal'
    )
  ),
  add constraint fulfillment_events_to_stage_check
  check (to_stage in (
    'waiting_payment',
    'reconciliation_required',
    'preparing',
    'ready_for_transfer',
    'in_transit_to_center',
    'center_received',
    'center_stored',
    'packed',
    'shipped',
    'cancelled',
    'legacy_terminal'
  ));

create table public.commerce_shipments (
  id uuid primary key default gen_random_uuid(),
  shipping_request_id uuid not null,
  member_id uuid not null,
  business_id uuid not null,
  fulfillment_center_id uuid not null,
  status text not null default 'requested'
    check (status in (
      'requested',
      'packed',
      'shipped',
      'cancelled',
      'reconciliation_required'
    )),
  settlement_method text not null
    check (settlement_method in ('shipping_credit', 'manual_transfer')),
  shipping_fee_payment_id uuid,
  shipping_credit_ledger_id uuid,
  address_snapshot jsonb not null
    check (
      jsonb_typeof(address_snapshot) = 'object'
      and octet_length(address_snapshot::text) <= 8192
    ),
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
  constraint commerce_shipments_shipping_request_member_fkey
    foreign key (shipping_request_id, member_id)
    references public.shipping_requests (id, member_id)
    on delete restrict,
  constraint commerce_shipments_center_business_fkey
    foreign key (fulfillment_center_id, business_id)
    references public.fulfillment_centers (id, business_id)
    on delete restrict,
  constraint commerce_shipments_shipping_fee_identity_fkey
    foreign key (
      shipping_fee_payment_id,
      member_id,
      shipping_request_id
    )
    references public.shipping_fee_payments (
      id,
      member_id,
      shipping_request_id
    )
    on delete restrict,
  constraint commerce_shipments_shipping_credit_identity_fkey
    foreign key (
      shipping_credit_ledger_id,
      member_id,
      shipping_request_id
    )
    references public.shipping_credit_ledger (
      id,
      member_id,
      shipping_request_id
    )
    on delete restrict,
  constraint commerce_shipments_shipping_request_key
    unique (shipping_request_id),
  constraint commerce_shipments_shipping_fee_payment_key
    unique (shipping_fee_payment_id),
  constraint commerce_shipments_shipping_credit_ledger_key
    unique (shipping_credit_ledger_id),
  constraint commerce_shipments_identity_key
    unique (
      id,
      member_id,
      business_id,
      fulfillment_center_id
    ),
  constraint commerce_shipments_settlement_check
    check (
      (
        settlement_method = 'shipping_credit'
        and shipping_credit_ledger_id is not null
        and shipping_fee_payment_id is null
      )
      or (
        settlement_method = 'manual_transfer'
        and shipping_fee_payment_id is not null
        and shipping_credit_ledger_id is null
      )
    ),
  constraint commerce_shipments_status_details_check
    check (
      (
        status in ('requested', 'reconciliation_required')
        and courier is null
        and tracking_number is null
        and packed_at is null
        and packed_by is null
        and shipped_at is null
        and shipped_by is null
        and cancelled_at is null
        and cancellation_reason is null
      )
      or (
        status = 'packed'
        and courier is null
        and tracking_number is null
        and packed_at is not null
        and packed_by is not null
        and shipped_at is null
        and shipped_by is null
        and cancelled_at is null
        and cancellation_reason is null
      )
      or (
        status = 'shipped'
        and courier is not null
        and tracking_number is not null
        and char_length(btrim(courier)) between 1 and 80
        and char_length(btrim(tracking_number)) between 1 and 120
        and packed_at is not null
        and packed_by is not null
        and shipped_at is not null
        and shipped_by is not null
        and cancelled_at is null
        and cancellation_reason is null
      )
      or (
        status = 'cancelled'
        and courier is null
        and tracking_number is null
        and packed_at is null
        and packed_by is null
        and shipped_at is null
        and shipped_by is null
        and cancelled_at is not null
        and cancellation_reason is not null
        and char_length(btrim(cancellation_reason)) between 3 and 500
      )
    ),
  constraint commerce_shipments_timestamp_order_check
    check (
      updated_at >= created_at
      and (packed_at is null or packed_at >= created_at)
      and (shipped_at is null or shipped_at >= packed_at)
      and (cancelled_at is null or cancelled_at >= created_at)
    )
);

create unique index commerce_shipments_tracking_key
  on public.commerce_shipments (
    lower(btrim(courier)),
    btrim(tracking_number)
  )
  where status = 'shipped';

create index commerce_shipments_work_queue_idx
  on public.commerce_shipments (
    business_id,
    status,
    updated_at,
    id
  );

create index commerce_shipments_center_business_idx
  on public.commerce_shipments (fulfillment_center_id, business_id);

create index commerce_shipments_packed_by_idx
  on public.commerce_shipments (packed_by)
  where packed_by is not null;

create index commerce_shipments_shipped_by_idx
  on public.commerce_shipments (shipped_by)
  where shipped_by is not null;

create table public.commerce_shipment_orders (
  shipment_id uuid not null,
  order_id uuid not null,
  member_id uuid not null,
  business_id uuid not null,
  fulfillment_center_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (shipment_id, order_id),
  constraint commerce_shipment_orders_order_key unique (order_id),
  constraint commerce_shipment_orders_identity_key
    unique (
      shipment_id,
      order_id,
      member_id,
      business_id,
      fulfillment_center_id
    ),
  constraint commerce_shipment_orders_shipment_identity_fkey
    foreign key (
      shipment_id,
      member_id,
      business_id,
      fulfillment_center_id
    )
    references public.commerce_shipments (
      id,
      member_id,
      business_id,
      fulfillment_center_id
    )
    on delete restrict,
  constraint commerce_shipment_orders_order_member_fkey
    foreign key (order_id, member_id)
    references public.commerce_orders (id, member_id)
    on delete restrict
);

create table public.commerce_shipment_items (
  shipment_id uuid not null,
  order_id uuid not null,
  order_item_id uuid not null,
  product_id uuid not null,
  store_id uuid not null,
  member_id uuid not null,
  business_id uuid not null,
  fulfillment_center_id uuid not null,
  manifest_fulfillment_version bigint not null check (manifest_fulfillment_version >= 0),
  packed_fulfillment_version bigint check (packed_fulfillment_version >= 0),
  shipped_fulfillment_version bigint check (shipped_fulfillment_version >= 0),
  created_at timestamptz not null default clock_timestamp(),
  primary key (shipment_id, order_item_id),
  constraint commerce_shipment_items_order_item_key unique (order_item_id),
  constraint commerce_shipment_items_product_key unique (product_id),
  constraint commerce_shipment_items_shipment_order_fkey
    foreign key (
      shipment_id,
      order_id,
      member_id,
      business_id,
      fulfillment_center_id
    )
    references public.commerce_shipment_orders (
      shipment_id,
      order_id,
      member_id,
      business_id,
      fulfillment_center_id
    )
    on delete restrict,
  constraint commerce_shipment_items_order_item_identity_fkey
    foreign key (order_item_id, order_id, product_id, store_id)
    references public.commerce_order_items (id, order_id, product_id, store_id)
    on delete restrict,
  constraint commerce_shipment_items_fulfillment_identity_fkey
    foreign key (
      order_item_id,
      order_id,
      store_id,
      business_id,
      fulfillment_center_id
    )
    references public.order_item_fulfillments (
      order_item_id,
      order_id,
      store_id,
      business_id,
      fulfillment_center_id
    )
    on delete restrict,
  constraint commerce_shipment_items_version_order_check
    check (
      packed_fulfillment_version is null
      or packed_fulfillment_version > manifest_fulfillment_version
    ),
  constraint commerce_shipment_items_shipped_version_order_check
    check (
      shipped_fulfillment_version is null
      or (
        packed_fulfillment_version is not null
        and shipped_fulfillment_version > packed_fulfillment_version
      )
    )
);

create index commerce_shipment_items_manifest_idx
  on public.commerce_shipment_items (shipment_id, order_id, order_item_id);

create table public.commerce_shipment_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null
    references public.commerce_shipments (id) on delete restrict,
  sequence_no bigint not null check (sequence_no > 0),
  event_type text not null
    check (event_type in (
      'requested',
      'packed',
      'shipped',
      'tracking_corrected',
      'cancelled',
      'reconciliation_required'
    )),
  from_status text,
  to_status text not null,
  actor_kind text not null
    check (actor_kind in ('user', 'system', 'migration')),
  actor_user_id uuid,
  actor_role_snapshot text not null
    check (char_length(btrim(actor_role_snapshot)) between 1 and 80),
  idempotency_key uuid not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint commerce_shipment_events_sequence_key
    unique (shipment_id, sequence_no),
  constraint commerce_shipment_events_idempotency_key
    unique (shipment_id, idempotency_key),
  constraint commerce_shipment_events_actor_check
    check (actor_kind <> 'user' or actor_user_id is not null),
  constraint commerce_shipment_events_status_check
    check (
      (from_status is null or from_status in (
        'requested', 'packed', 'shipped', 'cancelled', 'reconciliation_required'
      ))
      and to_status in (
        'requested', 'packed', 'shipped', 'cancelled', 'reconciliation_required'
      )
    ),
  constraint commerce_shipment_events_reason_check
    check (
      reason is null
      or (
        char_length(btrim(reason)) between 1 and 500
        and reason !~ '[[:cntrl:]]'
      )
    ),
  constraint commerce_shipment_events_metadata_check
    check (
      jsonb_typeof(metadata) = 'object'
      and octet_length(metadata::text) <= 8192
    )
);

create index commerce_shipment_events_history_idx
  on public.commerce_shipment_events (
    shipment_id,
    sequence_no desc
  );

create table public.commerce_shipment_reconciliation_cases (
  id uuid primary key default gen_random_uuid(),
  shipping_request_id uuid not null unique
    references public.shipping_requests (id) on delete restrict,
  reason_code text not null
    check (reason_code in (
      'legacy_requested_unverified',
      'legacy_shipped_unverified',
      'legacy_cancelled_history',
      'ambiguous_order_mapping',
      'auction_fulfillment_missing'
    )),
  status text not null default 'open'
    check (status in ('open', 'resolved')),
  details jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(details) = 'object'
      and octet_length(details::text) <= 8192
    ),
  resolved_by uuid references public.profiles (id) on delete restrict,
  resolution_note text,
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  constraint commerce_shipment_reconciliation_resolution_check
    check (
      (
        status = 'open'
        and resolved_by is null
        and resolved_at is null
        and resolution_note is null
      )
      or (
        status = 'resolved'
        and resolved_by is not null
        and resolved_at is not null
        and char_length(btrim(resolution_note)) between 3 and 1000
      )
  )
);

create index commerce_shipment_reconciliation_resolved_by_idx
  on public.commerce_shipment_reconciliation_cases (resolved_by)
  where resolved_by is not null;

insert into public.commerce_shipment_reconciliation_cases (
  shipping_request_id,
  reason_code,
  details
)
select
  requests.id,
  case requests.status
    when 'shipped' then 'legacy_shipped_unverified'
    when 'cancelled' then 'legacy_cancelled_history'
    else 'legacy_requested_unverified'
  end,
  jsonb_build_object(
    'source', 'legacy_shipping_request',
    'observed_status', requests.status,
    'observed_item_count', count(items.product_id),
    'physical_receipt_inferred', false,
    'packing_inferred', false
  )
from public.shipping_requests as requests
left join public.shipping_request_items as items
  on items.request_id = requests.id
group by requests.id, requests.status;

-- Every request created after this migration must be classified in the same
-- transaction as either canonical commerce shipping or explicit legacy
-- reconciliation. This closes the deployment window before the legacy RPCs
-- are revoked by the activation migration.
create or replace function app_private.enforce_shipping_request_classification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.commerce_shipments as shipments
    where shipments.shipping_request_id = new.id
  ) and not exists (
    select 1
    from public.commerce_shipment_reconciliation_cases as cases
    where cases.shipping_request_id = new.id
  ) then
    raise exception using
      errcode = '23514',
      message = '배송 요청은 정식 주문 배송 또는 레거시 조정 대상으로 원자적으로 분류되어야 합니다.';
  end if;
  return null;
end;
$$;

revoke all on function app_private.enforce_shipping_request_classification()
from public, anon, authenticated, service_role;

create constraint trigger shipping_requests_require_classification
after insert on public.shipping_requests
deferrable initially deferred
for each row execute function app_private.enforce_shipping_request_classification();

create or replace function app_private.validate_commerce_shipment_manifest(
  p_shipment_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shipment public.commerce_shipments%rowtype;
  v_request_id uuid;
begin
  select shipments.*
  into v_shipment
  from public.commerce_shipments as shipments
  where shipments.id = p_shipment_id;

  if not found then
    return;
  end if;

  v_request_id := v_shipment.shipping_request_id;

  if not exists (
    select 1
    from public.commerce_shipment_orders as shipment_orders
    where shipment_orders.shipment_id = p_shipment_id
  ) then
    raise exception using
      errcode = '23514',
      message = '정식 배송에는 최소 한 개의 통합 주문이 필요합니다.';
  end if;

  if exists (
    select 1
    from public.commerce_shipment_orders as shipment_orders
    where shipment_orders.shipment_id = p_shipment_id
      and (
        exists (
          select 1
          from public.commerce_order_items as order_items
          where order_items.order_id = shipment_orders.order_id
            and not exists (
              select 1
              from public.commerce_shipment_items as shipment_items
              where shipment_items.shipment_id = p_shipment_id
                and shipment_items.order_item_id = order_items.id
            )
        )
        or exists (
          select 1
          from public.commerce_shipment_items as shipment_items
          where shipment_items.shipment_id = p_shipment_id
            and shipment_items.order_id = shipment_orders.order_id
            and not exists (
              select 1
              from public.commerce_order_items as order_items
              where order_items.id = shipment_items.order_item_id
                and order_items.order_id = shipment_orders.order_id
            )
        )
      )
  ) then
    raise exception using
      errcode = '23514',
      message = '정식 배송 manifest가 통합 주문 전체 상품과 일치하지 않습니다.';
  end if;

  if exists (
    (
      select request_items.product_id
      from public.shipping_request_items as request_items
      where request_items.request_id = v_request_id
      except
      select shipment_items.product_id
      from public.commerce_shipment_items as shipment_items
      where shipment_items.shipment_id = p_shipment_id
    )
    union all
    (
      select shipment_items.product_id
      from public.commerce_shipment_items as shipment_items
      where shipment_items.shipment_id = p_shipment_id
      except
      select request_items.product_id
      from public.shipping_request_items as request_items
      where request_items.request_id = v_request_id
    )
  ) then
    raise exception using
      errcode = '23514',
      message = '배송 요청 상품과 정식 배송 manifest가 일치하지 않습니다.';
  end if;

  if v_shipment.settlement_method = 'shipping_credit' and (
    (
      select count(*)
      from public.shipping_credit_ledger as credits
      where credits.member_id = v_shipment.member_id
        and credits.shipping_request_id = v_request_id
    ) <> 1
    or not exists (
      select 1
      from public.shipping_credit_ledger as credits
      where credits.id = v_shipment.shipping_credit_ledger_id
        and credits.member_id = v_shipment.member_id
        and credits.shipping_request_id = v_request_id
        and credits.reason = 'used'
        and credits.delta = -1
    )
    or exists (
      select 1
      from public.shipping_fee_payments as payments
      where payments.member_id = v_shipment.member_id
        and payments.shipping_request_id = v_request_id
    )
  ) then
    raise exception using
      errcode = '23514',
      message = '배송 이용권 요청에는 이용권 차감 한 건만 연결되어야 합니다.';
  elsif v_shipment.settlement_method = 'manual_transfer' and (
    (
      select count(*)
      from public.shipping_fee_payments as payments
      where payments.member_id = v_shipment.member_id
        and payments.shipping_request_id = v_request_id
    ) <> 1
    or not exists (
      select 1
      from public.shipping_fee_payments as payments
      where payments.id = v_shipment.shipping_fee_payment_id
        and payments.member_id = v_shipment.member_id
        and payments.shipping_request_id = v_request_id
    )
    or exists (
      select 1
      from public.shipping_credit_ledger as credits
      where credits.member_id = v_shipment.member_id
        and credits.shipping_request_id = v_request_id
    )
  ) then
    raise exception using
      errcode = '23514',
      message = '배송비 계좌이체 요청에는 배송비 결제 한 건만 연결되어야 합니다.';
  end if;
end;
$$;

revoke all on function app_private.validate_commerce_shipment_manifest(uuid)
from public, anon, authenticated, service_role;

create or replace function app_private.enforce_commerce_shipment_manifest()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shipment_id uuid;
begin
  if tg_table_name = 'commerce_shipments' then
    v_shipment_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    v_shipment_id := case
      when tg_op = 'DELETE' then old.shipment_id
      else new.shipment_id
    end;
  end if;

  perform app_private.validate_commerce_shipment_manifest(v_shipment_id);
  return null;
end;
$$;

revoke all on function app_private.enforce_commerce_shipment_manifest()
from public, anon, authenticated, service_role;

create constraint trigger commerce_shipments_manifest_complete
after insert or update on public.commerce_shipments
deferrable initially deferred
for each row execute function app_private.enforce_commerce_shipment_manifest();

create constraint trigger commerce_shipment_orders_manifest_complete
after insert or update or delete on public.commerce_shipment_orders
deferrable initially deferred
for each row execute function app_private.enforce_commerce_shipment_manifest();

create constraint trigger commerce_shipment_items_manifest_complete
after insert or update or delete on public.commerce_shipment_items
deferrable initially deferred
for each row execute function app_private.enforce_commerce_shipment_manifest();

create or replace function app_private.enforce_commerce_shipment_settlement_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_request_id uuid;
  v_new_request_id uuid;
  v_shipment_id uuid;
begin
  if tg_op <> 'INSERT' then
    v_old_request_id := old.shipping_request_id;
  end if;
  if tg_op <> 'DELETE' then
    v_new_request_id := new.shipping_request_id;
  end if;

  for v_shipment_id in
    select shipments.id
    from public.commerce_shipments as shipments
    where shipments.shipping_request_id in (
      v_old_request_id,
      v_new_request_id
    )
    order by shipments.id
  loop
    perform app_private.validate_commerce_shipment_manifest(v_shipment_id);
  end loop;
  return null;
end;
$$;

revoke all on function app_private.enforce_commerce_shipment_settlement_source()
from public, anon, authenticated, service_role;

create constraint trigger shipping_fee_payments_validate_canonical_settlement
after insert or update or delete on public.shipping_fee_payments
deferrable initially deferred
for each row execute function app_private.enforce_commerce_shipment_settlement_source();

create constraint trigger shipping_credit_ledger_validate_canonical_settlement
after insert or update or delete on public.shipping_credit_ledger
deferrable initially deferred
for each row execute function app_private.enforce_commerce_shipment_settlement_source();

create or replace function app_private.guard_canonical_order_item_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.order_id is not distinct from old.order_id
    and new.product_id is not distinct from old.product_id
    and new.store_id is not distinct from old.store_id
  then
    return new;
  end if;

  if exists (
    select 1
    from public.commerce_shipment_items as shipment_items
    where shipment_items.order_item_id = old.id
  ) then
    raise exception using
      errcode = '55000',
      message = '정식 배송에 포함된 주문 상품의 주문·상품·매장 경계는 변경할 수 없습니다.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_canonical_order_item_identity()
from public, anon, authenticated, service_role;

create trigger commerce_order_items_guard_canonical_identity
before update of order_id, product_id, store_id or delete
on public.commerce_order_items
for each row execute function app_private.guard_canonical_order_item_identity();

create or replace function app_private.guard_canonical_request_item_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_request_id uuid;
  v_new_request_id uuid;
begin
  if tg_op <> 'INSERT' then
    v_old_request_id := old.request_id;
  end if;
  if tg_op <> 'DELETE' then
    v_new_request_id := new.request_id;
  end if;

  if exists (
    select 1
    from public.commerce_shipments as shipments
    where shipments.shipping_request_id in (
      v_old_request_id,
      v_new_request_id
    )
  ) then
    raise exception using
      errcode = '55000',
      message = '정식 배송에 포함된 호환 배송 요청 상품은 변경할 수 없습니다.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_canonical_request_item_identity()
from public, anon, authenticated, service_role;

create trigger shipping_request_items_guard_canonical_identity
before insert or update or delete on public.shipping_request_items
for each row execute function app_private.guard_canonical_request_item_identity();

create or replace function app_private.reject_commerce_shipment_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = '정식 배송 이벤트는 수정하거나 삭제할 수 없습니다.';
end;
$$;

revoke all on function app_private.reject_commerce_shipment_event_mutation()
from public, anon, authenticated, service_role;

create trigger commerce_shipment_events_append_only
before update or delete or truncate
on public.commerce_shipment_events
for each statement
execute function app_private.reject_commerce_shipment_event_mutation();

alter table public.commerce_shipments enable row level security;
alter table public.commerce_shipments force row level security;
alter table public.commerce_shipment_orders enable row level security;
alter table public.commerce_shipment_orders force row level security;
alter table public.commerce_shipment_items enable row level security;
alter table public.commerce_shipment_items force row level security;
alter table public.commerce_shipment_events enable row level security;
alter table public.commerce_shipment_events force row level security;
alter table public.commerce_shipment_reconciliation_cases enable row level security;
alter table public.commerce_shipment_reconciliation_cases force row level security;

revoke all privileges on table
  public.commerce_shipments,
  public.commerce_shipment_orders,
  public.commerce_shipment_items,
  public.commerce_shipment_events,
  public.commerce_shipment_reconciliation_cases
from public, anon, authenticated, service_role;

comment on table public.commerce_shipments is
  'Canonical combined-shipment aggregate. Legacy shipping_requests remains a compatibility intent/projection only.';
comment on table public.commerce_shipment_orders is
  'Orders included in one canonical shipment. Activation currently permits one complete order while preserving future stored-order consolidation.';
comment on table public.commerce_shipment_items is
  'Server-built, complete order-item manifest for a canonical shipment.';
comment on table public.commerce_shipment_events is
  'Append-only canonical packing, dispatch, and tracking-correction history.';
comment on table public.commerce_shipment_reconciliation_cases is
  'Legacy shipping records that must never be treated as central receipt or packing evidence without explicit reconciliation.';

commit;
