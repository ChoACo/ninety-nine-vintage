begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

-- Direct-store fulfillment retired the operator-facing center workflow, but
-- the immutable inventory tables still keep a center UUID as an internal
-- compatibility key. Entitlement projection must therefore accept the
-- business's retained compatibility center even when that center is archived.
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
  v_route_version bigint;
  v_legacy_storage_expires timestamptz;
  v_legacy_commerce_shipment uuid;
  v_item uuid;
  v_stage text;
  v_location text;
begin
  if p_source_kind = 'commerce' then
    select
      orders.member_id,
      stores.business_id,
      items.store_id,
      items.product_id,
      items.unit_price,
      coalesce(items.paid_at, orders.updated_at),
      products.storage_class,
      products.closes_at,
      items.storage_expires_at,
      shipment_items.shipment_id
    into
      v_member,
      v_business,
      v_store,
      v_product,
      v_amount,
      v_paid_at,
      v_storage_class,
      v_closes_at,
      v_legacy_storage_expires,
      v_legacy_commerce_shipment
    from public.commerce_order_items as items
    join public.commerce_orders as orders on orders.id = items.order_id
    join public.products as products on products.id = items.product_id
    join public.stores as stores on stores.id = items.store_id
    left join public.commerce_shipment_items as shipment_items
      on shipment_items.order_item_id = items.id
    where items.id = p_source_id
      and items.payment_status = 'paid';
  elsif p_source_kind = 'auction' then
    select
      transfers.buyer_id,
      stores.business_id,
      products.store_id,
      transfers.product_id,
      transfers.expected_amount,
      transfers.confirmed_at,
      products.storage_class,
      products.closes_at
    into
      v_member,
      v_business,
      v_store,
      v_product,
      v_amount,
      v_paid_at,
      v_storage_class,
      v_closes_at
    from public.manual_transfer_orders as transfers
    join public.products as products on products.id = transfers.product_id
    join public.stores as stores on stores.id = products.store_id
    where transfers.id = p_source_id
      and transfers.status = 'confirmed'
      and transfers.buyer_id is not null;
  elsif p_source_kind = 'legacy_portone' then
    select
      payments.buyer_id,
      stores.business_id,
      products.store_id,
      payments.product_id,
      payments.expected_amount,
      payments.paid_at,
      products.storage_class,
      products.closes_at
    into
      v_member,
      v_business,
      v_store,
      v_product,
      v_amount,
      v_paid_at,
      v_storage_class,
      v_closes_at
    from public.payment_orders as payments
    join public.products as products on products.id = payments.product_id
    join public.stores as stores on stores.id = products.store_id
    where payments.id = p_source_id
      and payments.payment_status = '결제완료'
      and payments.portone_status = 'PAID'
      and payments.buyer_id is not null;
  else
    raise exception using
      errcode = '22023',
      message = '지원하지 않는 결제 원천입니다.';
  end if;

  if v_member is null then
    return null;
  end if;
  if not exists (
    select 1
    from public.inventory_fulfillment_rollout_settings as settings
    where settings.business_id = v_business
      and settings.entitlement_projection_enabled
  ) then
    return null;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'direct-store-inventory:' || v_store::text,
      0
    )
  );

  select
    routes.fulfillment_center_id,
    routes.version
  into
    v_center,
    v_route_version
  from public.store_fulfillment_routes as routes
  join public.fulfillment_centers as centers
    on centers.id = routes.fulfillment_center_id
   and centers.business_id = v_business
  where routes.store_id = v_store
    and routes.status = 'active'
  order by routes.updated_at desc, routes.id
  limit 1
  for key share of routes, centers;

  if v_center is null then
    select centers.id, 0::bigint
    into v_center, v_route_version
    from public.fulfillment_centers as centers
    where centers.business_id = v_business
    order by centers.is_default desc, centers.created_at, centers.id
    limit 1
    for key share;
  end if;

  insert into public.customer_inventory_items (
    member_id,
    business_id,
    origin_store_id,
    product_id,
    fulfillment_center_id,
    route_mode,
    route_version,
    source_kind,
    commerce_order_item_id,
    manual_transfer_order_id,
    legacy_payment_order_id,
    legacy_commerce_shipment_id,
    paid_amount,
    paid_at,
    storage_class_snapshot,
    storage_duration_days,
    work_due_date,
    storage_started_at,
    storage_expires_at
  ) values (
    v_member,
    v_business,
    v_store,
    v_product,
    v_center,
    case when v_center is null then null else 'co_located' end,
    case when v_center is null then null else coalesce(v_route_version, 0) end,
    p_source_kind,
    case when p_source_kind = 'commerce' then p_source_id end,
    case when p_source_kind = 'auction' then p_source_id end,
    case when p_source_kind = 'legacy_portone' then p_source_id end,
    v_legacy_commerce_shipment,
    v_amount,
    coalesce(v_paid_at, clock_timestamp()),
    v_storage_class,
    case when v_storage_class = 'large' then 7 else 14 end,
    (
      greatest(v_closes_at, coalesce(v_paid_at, clock_timestamp()))
      at time zone 'Asia/Seoul'
    )::date + 1,
    case
      when v_legacy_storage_expires is not null
      then v_legacy_storage_expires - make_interval(
        days => case when v_storage_class = 'large' then 7 else 14 end
      )
    end,
    v_legacy_storage_expires
  )
  on conflict do nothing
  returning id into v_item;

  if v_item is null then
    select inventory.id
    into v_item
    from public.customer_inventory_items as inventory
    where inventory.commerce_order_item_id =
          case when p_source_kind = 'commerce' then p_source_id end
       or inventory.manual_transfer_order_id =
          case when p_source_kind = 'auction' then p_source_id end
       or inventory.legacy_payment_order_id =
          case when p_source_kind = 'legacy_portone' then p_source_id end;
    return v_item;
  end if;

  v_stage := case when v_center is null
    then 'reconciliation_required'
    else 'entitled'
  end;
  v_location := case when v_center is null then 'unknown' else 'store' end;

  insert into public.inventory_item_fulfillments (
    inventory_item_id,
    business_id,
    origin_store_id,
    fulfillment_center_id,
    route_mode,
    current_stage,
    location_kind
  ) values (
    v_item,
    v_business,
    v_store,
    v_center,
    case when v_center is null then null else 'co_located' end,
    v_stage,
    v_location
  );

  insert into public.inventory_item_fulfillment_events (
    inventory_item_id,
    sequence_no,
    event_type,
    to_stage,
    to_location_kind,
    actor_kind,
    idempotency_key,
    reason_code
  ) values (
    v_item,
    1,
    case when v_center is null
      then 'reconciliation_required'
      else 'entitled'
    end,
    v_stage,
    v_location,
    'system',
    gen_random_uuid(),
    case when v_center is null
      then 'direct_store_compatibility_key_missing'
      else 'direct_store_entitlement'
    end
  );

  insert into public.store_financial_entries (
    business_id,
    origin_store_id,
    inventory_item_id,
    entry_kind,
    amount,
    occurred_at,
    idempotency_key,
    metadata
  ) values (
    v_business,
    v_store,
    v_item,
    'item_payment',
    v_amount,
    coalesce(v_paid_at, clock_timestamp()),
    gen_random_uuid(),
    jsonb_build_object(
      'sourceKind', p_source_kind,
      'sourceId', p_source_id,
      'flow', 'direct_store'
    )
  );

  return v_item;
end;
$$;

revoke all on function app_private.create_customer_inventory_entitlement(
  text,
  uuid
) from public, anon, authenticated, service_role;

lock table
  public.commerce_order_items,
  public.manual_transfer_orders,
  public.payment_orders
in share row exclusive mode;

do $repair$
declare
  v_business_id uuid;
begin
  for v_business_id in
    select settings.business_id
    from public.inventory_fulfillment_rollout_settings as settings
    where exists (
      select 1
      from public.stores as stores
      where stores.business_id = settings.business_id
        and stores.is_active
    )
      and exists (
        select 1
        from public.fulfillment_centers as centers
        where centers.business_id = settings.business_id
      )
    order by settings.business_id
  loop
    update public.inventory_fulfillment_rollout_settings
    set
      entitlement_projection_enabled = true,
      unified_inventory_reads_enabled = false,
      item_selected_shipments_enabled = false,
      version = version + 1,
      updated_at = clock_timestamp()
    where business_id = v_business_id
      and (
        not entitlement_projection_enabled
        or unified_inventory_reads_enabled
        or item_selected_shipments_enabled
      );

    perform app_private.create_customer_inventory_entitlement(
      'commerce',
      items.id
    )
    from public.commerce_order_items as items
    join public.stores as stores on stores.id = items.store_id
    where stores.business_id = v_business_id
      and items.payment_status = 'paid';

    perform app_private.create_customer_inventory_entitlement(
      'auction',
      transfers.id
    )
    from public.manual_transfer_orders as transfers
    join public.products as products on products.id = transfers.product_id
    join public.stores as stores on stores.id = products.store_id
    where stores.business_id = v_business_id
      and transfers.status = 'confirmed';

    perform app_private.create_customer_inventory_entitlement(
      'legacy_portone',
      payments.id
    )
    from public.payment_orders as payments
    join public.products as products on products.id = payments.product_id
    join public.stores as stores on stores.id = products.store_id
    where stores.business_id = v_business_id
      and payments.payment_status = '결제완료'
      and payments.portone_status = 'PAID';

    with resolved as (
      select
        inventory.id as inventory_item_id,
        coalesce(
          route_center.fulfillment_center_id,
          fallback_center.fulfillment_center_id
        ) as fulfillment_center_id,
        coalesce(route_center.route_version, 0) as route_version
      from public.customer_inventory_items as inventory
      join public.inventory_item_fulfillments as fulfillments
        on fulfillments.inventory_item_id = inventory.id
      left join lateral (
        select
          centers.id as fulfillment_center_id,
          routes.version as route_version
        from public.store_fulfillment_routes as routes
        join public.fulfillment_centers as centers
          on centers.id = routes.fulfillment_center_id
         and centers.business_id = inventory.business_id
        where routes.store_id = inventory.origin_store_id
          and routes.status = 'active'
        order by routes.updated_at desc, routes.id
        limit 1
      ) as route_center on true
      left join lateral (
        select centers.id as fulfillment_center_id
        from public.fulfillment_centers as centers
        where centers.business_id = inventory.business_id
        order by centers.is_default desc, centers.created_at, centers.id
        limit 1
      ) as fallback_center on route_center.fulfillment_center_id is null
      where fulfillments.business_id = v_business_id
        and fulfillments.current_stage = 'reconciliation_required'
    )
    update public.customer_inventory_items as inventory
    set
      fulfillment_center_id = resolved.fulfillment_center_id,
      route_mode = 'co_located',
      route_version = resolved.route_version,
      version = inventory.version + 1,
      updated_at = clock_timestamp()
    from resolved
    where resolved.inventory_item_id = inventory.id
      and resolved.fulfillment_center_id is not null;

    insert into public.inventory_item_fulfillment_events (
      inventory_item_id,
      sequence_no,
      event_type,
      from_stage,
      to_stage,
      from_location_kind,
      to_location_kind,
      actor_kind,
      idempotency_key,
      reason_code,
      note
    )
    select
      fulfillments.inventory_item_id,
      coalesce((
        select max(events.sequence_no) + 1
        from public.inventory_item_fulfillment_events as events
        where events.inventory_item_id = fulfillments.inventory_item_id
      ), 1),
      'entitled',
      'reconciliation_required',
      'preparing',
      'unknown',
      'store',
      'system',
      gen_random_uuid(),
      'direct_store_reconciled',
      'Retained compatibility key applied after direct-store cutover'
    from public.inventory_item_fulfillments as fulfillments
    join public.customer_inventory_items as inventory
      on inventory.id = fulfillments.inventory_item_id
    where fulfillments.business_id = v_business_id
      and fulfillments.current_stage = 'reconciliation_required'
      and inventory.fulfillment_center_id is not null;

    update public.inventory_item_fulfillments as fulfillments
    set
      fulfillment_center_id = inventory.fulfillment_center_id,
      route_mode = 'co_located',
      current_stage = 'preparing',
      location_kind = 'store',
      version = fulfillments.version + 1,
      last_event_at = clock_timestamp(),
      updated_at = clock_timestamp()
    from public.customer_inventory_items as inventory
    where inventory.id = fulfillments.inventory_item_id
      and fulfillments.business_id = v_business_id
      and fulfillments.current_stage = 'reconciliation_required'
      and inventory.fulfillment_center_id is not null;

    if exists (
      select 1
      from public.inventory_item_fulfillments as fulfillments
      where fulfillments.business_id = v_business_id
        and fulfillments.current_stage = 'reconciliation_required'
    ) then
      raise exception using
        errcode = '23514',
        message = '매장 직접 보관 호환키를 연결하지 못한 상품이 있습니다.';
    end if;

    update public.inventory_fulfillment_rollout_settings
    set
      unified_inventory_reads_enabled = true,
      item_selected_shipments_enabled = true,
      version = version + 1,
      updated_at = clock_timestamp()
    where business_id = v_business_id
      and (
        not unified_inventory_reads_enabled
        or not item_selected_shipments_enabled
      );
  end loop;
end
$repair$;

commit;
