begin;

-- Repair the cart RPC that failed at runtime because its OUT parameter
-- product_id conflicted with the unqualified ON CONFLICT column name.
create or replace function public.reserve_fixed_product_for_cart(p_product_id uuid)
returns table (product_id uuid, reserved_until timestamptz, server_time timestamptz)
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
begin
  if v_user_id is null or not public.is_member() then
    raise exception using errcode = '42501', message = '카카오 회원 로그인 후 장바구니를 이용해 주세요.';
  end if;
  if not exists (
    select 1
    from public.products as products
    where products.id = p_product_id
      and products.sale_type = 'fixed'
      and products.status = 'active'
      and products.publish_at <= v_now
  ) then
    raise exception using errcode = 'P0001', message = '현재 구매할 수 없는 상품입니다.';
  end if;

  insert into public.cart_items as cart_items (
    member_id, product_id, created_at, reserved_until
  ) values (
    v_user_id, p_product_id, v_now, null
  )
  on conflict on constraint cart_items_pkey do nothing;

  return query select p_product_id, null::timestamptz, v_now;
end;
$$;

revoke all on function public.reserve_fixed_product_for_cart(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.reserve_fixed_product_for_cart(uuid)
to authenticated;

-- UUID has no min aggregate. The loop only needs each shipment grouping key,
-- so remove the unused representative inventory item entirely.
create or replace function app_private.auto_direct_purchase_shipments(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.commerce_orders%rowtype;
  v_item record;
  v_shipment uuid;
  v_sequence integer;
begin
  select * into v_order
  from public.commerce_orders
  where id = p_order_id
  for update;
  if not found or not v_order.direct_ship or v_order.shipping_address_id is null then
    return;
  end if;

  for v_item in
    select
      inventory.member_id,
      inventory.business_id,
      inventory.origin_store_id,
      inventory.fulfillment_center_id
    from public.customer_inventory_items as inventory
    join public.commerce_order_items as order_items
      on order_items.id = inventory.commerce_order_item_id
    where order_items.order_id = p_order_id
      and order_items.payment_status = 'paid'
      and not exists (
        select 1
        from public.inventory_shipment_items as shipment_items
        where shipment_items.inventory_item_id = inventory.id
      )
    group by
      inventory.member_id,
      inventory.business_id,
      inventory.origin_store_id,
      inventory.fulfillment_center_id
  loop
    v_shipment := gen_random_uuid();
    insert into public.inventory_shipments (
      id, member_id, business_id, fulfillment_center_id, status,
      settlement_method, address_id, address_snapshot, unit_kind,
      unit_store_id, processing_store_id, unit_snapshot
    ) values (
      v_shipment, v_item.member_id, v_item.business_id,
      v_item.fulfillment_center_id, 'collecting', 'purchase_included',
      v_order.shipping_address_id, v_order.shipping_address_snapshot, 'store',
      v_item.origin_store_id, v_item.origin_store_id,
      jsonb_build_object('unitKind', 'store', 'storeId', v_item.origin_store_id)
    );

    insert into public.inventory_shipment_items (
      shipment_id, inventory_item_id, member_id, business_id,
      fulfillment_center_id, product_id, origin_store_id, line_status
    )
    select
      v_shipment, inventory.id, inventory.member_id, inventory.business_id,
      inventory.fulfillment_center_id, inventory.product_id,
      inventory.origin_store_id, 'requested'
    from public.customer_inventory_items as inventory
    join public.commerce_order_items as order_items
      on order_items.id = inventory.commerce_order_item_id
    where order_items.order_id = p_order_id
      and order_items.payment_status = 'paid'
      and inventory.origin_store_id = v_item.origin_store_id
      and inventory.fulfillment_center_id = v_item.fulfillment_center_id
      and not exists (
        select 1
        from public.inventory_shipment_items as shipment_items
        where shipment_items.inventory_item_id = inventory.id
      );

    insert into public.inventory_shipment_store_works (
      shipment_id, business_id, origin_store_id, fulfillment_center_id,
      route_mode, status
    ) values (
      v_shipment, v_item.business_id, v_item.origin_store_id,
      v_item.fulfillment_center_id, 'co_located', 'collecting'
    );

    select coalesce(max(events.sequence_no), 0) + 1
    into v_sequence
    from public.inventory_shipment_events as events
    where events.shipment_id = v_shipment;

    insert into public.inventory_shipment_events (
      shipment_id, sequence_no, event_type, to_status, actor_kind,
      actor_user_id, idempotency_key, metadata
    ) values (
      v_shipment, v_sequence, 'direct_purchase_shipping_requested',
      'collecting', 'system', null, gen_random_uuid(),
      jsonb_build_object('orderId', p_order_id, 'storeId', v_item.origin_store_id)
    );

    perform app_private.lock_inventory_shipment(v_shipment);
    perform app_private.refresh_inventory_shipment_status(v_shipment, gen_random_uuid());
  end loop;
end;
$$;

revoke all on function app_private.auto_direct_purchase_shipments(uuid)
from public, anon, authenticated, service_role;

-- Restore the regional checkout overload required by the newer direct-ship
-- overload. It was absent from the live schema even though later code calls it.
create or replace function public.create_commerce_manual_transfer_checkout(
  p_product_ids uuid[],
  p_idempotency_key text,
  p_apply_shipping_credit boolean,
  p_include_shipping_fee boolean,
  p_shipping_region text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order jsonb;
  v_order_id uuid;
  v_transfer jsonb;
  v_existing public.commerce_order_transfers%rowtype;
  v_allow boolean;
  v_surcharge bigint := 0;
begin
  if p_shipping_region not in ('regular', 'remote_area') then
    raise exception using errcode = '22023', message = '배송 지역 구분을 확인해 주세요.';
  end if;
  v_order := app_private.create_commerce_order(
    p_product_ids, p_idempotency_key, p_apply_shipping_credit
  );
  if jsonb_typeof(v_order) <> 'object' or nullif(v_order ->> 'id', '') is null then
    raise exception using errcode = 'XX000', message = '주문 생성 결과가 올바르지 않습니다.';
  end if;
  v_order_id := (v_order ->> 'id')::uuid;

  if coalesce(p_include_shipping_fee, false) then
    if exists (
      select 1
      from public.commerce_orders
      where id = v_order_id
        and shipping_region is not null
        and shipping_region is distinct from p_shipping_region
    ) then
      raise exception using errcode = '22000', message = '같은 주문 요청 키의 배송 지역 선택이 다릅니다.';
    end if;
    update public.commerce_orders
    set shipping_region = p_shipping_region
    where id = v_order_id and shipping_region is null;
  end if;

  v_allow := not exists (
    select 1 from public.commerce_order_transfers where order_id = v_order_id
  ) and not exists (
    select 1 from public.payment_orders where commerce_order_id = v_order_id
  );
  v_order := app_private.apply_commerce_checkout_shipping_fee(
    v_order_id, coalesce(p_include_shipping_fee, false), v_allow
  );

  if coalesce(p_include_shipping_fee, false) and p_shipping_region = 'remote_area' then
    if exists (
      select 1
      from public.commerce_order_shipping_fee_allocations
      where order_id = v_order_id and charge_key like 'remote:%'
    ) then
      null;
    elsif v_allow then
      with scoped as (
        select
          stores.id as store_id,
          stores.business_id,
          max(stores.remote_area_shipping_fee - stores.regular_shipping_fee) as surcharge
        from public.commerce_order_items as items
        join public.stores as stores on stores.id = items.store_id
        where items.order_id = v_order_id
        group by stores.id, stores.business_id
      )
      insert into public.commerce_order_shipping_fee_allocations (
        order_id, business_id, amount, charge_key, charge_mode,
        origin_store_id, billing_store_id, policy_snapshot
      )
      select
        v_order_id, business_id, surcharge, 'remote:' || store_id::text,
        'per_store', store_id, store_id,
        jsonb_build_object(
          'shippingRegion', 'remote_area',
          'remoteAreaSurcharge', surcharge
        )
      from scoped
      where surcharge > 0;

      select coalesce(sum(allocations.amount), 0)
      into v_surcharge
      from public.commerce_order_shipping_fee_allocations as allocations
      where allocations.order_id = v_order_id
        and allocations.charge_key like 'remote:%';

      update public.commerce_orders as orders
      set
        shipping_fee = orders.shipping_fee + v_surcharge,
        total = orders.total + v_surcharge,
        updated_at = clock_timestamp()
      where orders.id = v_order_id
      returning to_jsonb(orders.*) into v_order;
    else
      raise exception using errcode = '22000', message = '같은 주문 요청 키의 배송 지역 선택이 다릅니다.';
    end if;
  end if;

  select transfers.*
  into v_existing
  from public.commerce_order_transfers as transfers
  where transfers.order_id = v_order_id
  for update;
  if found then
    if v_existing.member_id is distinct from auth.uid()
      or v_existing.expected_amount is distinct from (v_order ->> 'total')::bigint
    then
      raise exception using errcode = '22000', message = '같은 주문 요청 키의 배송 지역 선택이 다릅니다.';
    end if;
    v_transfer := to_jsonb(v_existing);
  else
    v_transfer := public.create_commerce_order_transfer(v_order_id);
  end if;

  return jsonb_build_object('order', v_order, 'transfer', v_transfer);
end;
$$;

revoke all on function public.create_commerce_manual_transfer_checkout(
  uuid[], text, boolean, boolean, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_commerce_manual_transfer_checkout(
  uuid[], text, boolean, boolean, text
) to authenticated;

-- Correct the renamed fulfillment block column in both cancellation functions
-- while preserving their full current definitions and grants.
do $$
declare
  v_oid regprocedure;
  v_definition text;
  v_repaired text;
begin
  foreach v_oid in array array[
    'public.request_commerce_cancellation(uuid,text,text,text,uuid)'::regprocedure,
    'public.respond_commerce_cancellation(uuid,boolean,bigint,text,uuid)'::regprocedure
  ]
  loop
    v_definition := pg_get_functiondef(v_oid);
    v_repaired := replace(v_definition, 'blocked_reason', 'block_reason');
    if v_oid = 'public.request_commerce_cancellation(uuid,text,text,text,uuid)'::regprocedure then
      v_repaired := replace(
        v_repaired,
        'v_product.business_id',
        '(select stores.business_id from public.stores as stores where stores.id = v_product.store_id)'
      );
    end if;
    if v_repaired = v_definition then
      raise exception 'Expected blocked_reason reference was not found in %', v_oid;
    end if;
    execute v_repaired;
  end loop;
end;
$$;

-- This locator table contains private provider keys. Browser roles already had
-- all privileges revoked; enabling RLS also closes the PostgREST exposure
-- reported by the database advisor. Server service-role access still bypasses
-- RLS and no client policy is intentionally provided.
alter table public.multi_provider_records enable row level security;
revoke all on table public.multi_provider_records
from public, anon, authenticated;

-- The canary implementation revokes this helper after an earlier migration
-- granted it. Membership and support RLS policies invoke it as authenticated,
-- so restore only the zero-argument execution contract.
revoke all on function public.current_authorization_principal()
from public, anon, authenticated, service_role;
grant execute on function public.current_authorization_principal()
to authenticated, service_role;

-- These reads depend on clock_timestamp or the volatile authorization
-- principal. Marking them VOLATILE matches their real behavior and prevents
-- statement planners from reusing a stale result.
alter function public.get_my_cart_reservations() volatile;
alter function public.get_my_legacy_eligible_orders() volatile;
alter function public.get_store_daily_entitlements(uuid) volatile;
alter function public.get_operator_store_scope() volatile;

commit;
