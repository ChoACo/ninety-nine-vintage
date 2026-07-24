begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

-- A paid auction can only become a selectable shipment line after every store
-- in its business has an active, center-backed fulfillment route. Lock the
-- paid-source tables so rollout activation and the historical backfill cannot
-- miss a concurrent confirmation.
lock table
  public.commerce_order_items,
  public.manual_transfer_orders,
  public.payment_orders
in share row exclusive mode;

do $$
declare
  v_business_id uuid;
  v_item record;
begin
  perform set_config('app.inventory_entitlement_backfill', '1', true);

  for v_business_id in
    select settings.business_id
    from public.inventory_fulfillment_rollout_settings as settings
    where exists (
      select 1
      from public.stores as stores
      where stores.business_id = settings.business_id
    )
      and not exists (
        select 1
        from public.stores as stores
        left join public.store_fulfillment_routes as routes
          on routes.store_id = stores.id
          and routes.status = 'active'
        left join public.fulfillment_centers as centers
          on centers.id = routes.fulfillment_center_id
          and centers.business_id = stores.business_id
          and centers.status = 'active'
        where stores.business_id = settings.business_id
          and centers.id is null
      )
    order by settings.business_id
  loop
    update public.inventory_fulfillment_rollout_settings
    set
      entitlement_projection_enabled = true,
      unified_inventory_reads_enabled = true,
      item_selected_shipments_enabled = false,
      version = version + 1,
      updated_at = clock_timestamp()
    where business_id = v_business_id
      and (
        not entitlement_projection_enabled
        or not unified_inventory_reads_enabled
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

    -- Historical entitlements are intentionally born in reconciliation state.
    -- Because this migration only selects businesses whose stores already have
    -- explicit routes, copy those configured snapshots and record the system
    -- reconciliation before item-selected shipping is enabled.
    for v_item in
      select
        items.id,
        routes.fulfillment_center_id,
        routes.route_mode,
        routes.version as route_version
      from public.customer_inventory_items as items
      join public.inventory_item_fulfillments as fulfillments
        on fulfillments.inventory_item_id = items.id
      join public.store_fulfillment_routes as routes
        on routes.store_id = items.origin_store_id
        and routes.status = 'active'
      join public.fulfillment_centers as centers
        on centers.id = routes.fulfillment_center_id
        and centers.business_id = items.business_id
        and centers.status = 'active'
      where items.business_id = v_business_id
        and fulfillments.current_stage = 'reconciliation_required'
      order by items.id
      for update of items, fulfillments
    loop
      update public.customer_inventory_items
      set
        fulfillment_center_id = v_item.fulfillment_center_id,
        route_mode = v_item.route_mode,
        route_version = v_item.route_version,
        version = version + 1
      where id = v_item.id;

      update public.inventory_item_fulfillments
      set
        fulfillment_center_id = v_item.fulfillment_center_id,
        route_mode = v_item.route_mode,
        current_stage = 'preparing',
        location_kind = 'store',
        version = version + 1,
        last_event_at = clock_timestamp(),
        updated_at = clock_timestamp()
      where inventory_item_id = v_item.id;

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
      ) values (
        v_item.id,
        coalesce((
          select max(events.sequence_no) + 1
          from public.inventory_item_fulfillment_events as events
          where events.inventory_item_id = v_item.id
        ), 1),
        'entitled',
        'reconciliation_required',
        'preparing',
        'unknown',
        'store',
        'system',
        gen_random_uuid(),
        'route_reconciled',
        'Configured route applied during selectable paid inventory activation'
      );
    end loop;

    if exists (
      select 1
      from public.inventory_item_fulfillments as fulfillments
      where fulfillments.business_id = v_business_id
        and fulfillments.current_stage = 'reconciliation_required'
    ) then
      raise exception using
        errcode = '23514',
        message = '미조정 보관 상품이 남아 선택 배송을 활성화할 수 없습니다.';
    end if;

    update public.inventory_fulfillment_rollout_settings
    set
      item_selected_shipments_enabled = true,
      version = version + 1,
      updated_at = clock_timestamp()
    where business_id = v_business_id
      and not item_selected_shipments_enabled;
  end loop;

  perform set_config('app.inventory_entitlement_backfill', '0', true);
end;
$$;

commit;
