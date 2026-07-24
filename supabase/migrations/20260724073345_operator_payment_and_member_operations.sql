begin;

set local lock_timeout = '10s';
set local statement_timeout = '15min';

-- Store work is private to the assigned store. Owner keeps the cross-store
-- oversight view, while operators and employees only receive rows for stores
-- where they have the prepare_orders assignment.
create or replace function public.get_direct_store_fulfillment_groups(
  p_date date default null,
  p_limit integer default 24,
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
  if not public.can_view_shared_fulfillment() then
    raise exception using errcode = '42501', message = '상품 보관·출고 조회 권한이 없습니다.';
  end if;

  with group_rows as (
    select
      'store_paid_items'::text as action,
      null::uuid as work_id,
      null::bigint as work_version,
      (i.paid_at at time zone 'Asia/Seoul')::date as activity_date,
      i.member_id,
      pf.display_name as buyer_name,
      i.origin_store_id,
      s.name as origin_store_name,
      true as can_process,
      jsonb_agg(jsonb_build_object(
        'inventoryItemId', i.id,
        'productId', i.product_id,
        'title', p.title,
        'imageUrl', coalesce(p.image_urls[1], ''),
        'version', f.version,
        'requestedForShipping', false,
        'isBlocked', f.is_blocked
      ) order by coalesce(i.paid_at, i.created_at), i.id) as items
    from public.customer_inventory_items i
    join public.inventory_item_fulfillments f on f.inventory_item_id = i.id
    join public.products p on p.id = i.product_id
    join public.profiles pf on pf.id = i.member_id
    join public.stores s on s.id = i.origin_store_id
    where i.ownership_status = 'active'
      and f.current_stage in ('entitled', 'preparing', 'center_received')
      and not f.outbound_released
      and (public.is_owner() or public.has_store_permission(i.origin_store_id, 'prepare_orders'))
      and not exists (
        select 1
        from public.inventory_shipment_items x
        where x.inventory_item_id = i.id
          and x.line_status in ('requested', 'held', 'ready', 'packed')
      )
      and (p_date is null or (i.paid_at at time zone 'Asia/Seoul')::date = p_date)
    group by (i.paid_at at time zone 'Asia/Seoul')::date, i.member_id, pf.display_name,
      i.origin_store_id, s.name

    union all

    select
      'store_requested_items'::text,
      w.id,
      w.version,
      (sh.created_at at time zone 'Asia/Seoul')::date,
      sh.member_id,
      pf.display_name,
      w.origin_store_id,
      s.name,
      true,
      jsonb_agg(jsonb_build_object(
        'inventoryItemId', x.inventory_item_id,
        'productId', x.product_id,
        'title', p.title,
        'imageUrl', coalesce(p.image_urls[1], ''),
        'version', f.version,
        'requestedForShipping', true,
        'isBlocked', f.is_blocked
      ) order by x.created_at, x.inventory_item_id)
    from public.inventory_shipment_store_works w
    join public.inventory_shipments sh on sh.id = w.shipment_id
    join public.profiles pf on pf.id = sh.member_id
    join public.stores s on s.id = w.origin_store_id
    join public.inventory_shipment_items x
      on x.shipment_id = w.shipment_id
      and x.origin_store_id = w.origin_store_id
      and x.line_status in ('requested', 'held')
    join public.inventory_item_fulfillments f on f.inventory_item_id = x.inventory_item_id
    join public.products p on p.id = x.product_id
    where w.status = 'collecting'
      and (public.is_owner() or public.has_store_permission(w.origin_store_id, 'prepare_orders'))
      and (p_date is null or (sh.created_at at time zone 'Asia/Seoul')::date = p_date)
    group by w.id, w.version, (sh.created_at at time zone 'Asia/Seoul')::date, sh.member_id, pf.display_name,
      w.origin_store_id, s.name
  ),
  paged as (
    select *
    from group_rows
    order by activity_date desc, buyer_name, origin_store_name, work_id nulls first
    limit greatest(1, least(coalesce(p_limit, 24), 100))
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'groups', coalesce(jsonb_agg(jsonb_build_object(
      'groupId', action || ':' || activity_date::text || ':' || member_id::text || ':' ||
        origin_store_id::text || ':' || coalesce(work_id::text, 'paid'),
      'action', action,
      'workId', work_id,
      'workVersion', work_version,
      'activityDate', activity_date,
      'buyerId', member_id,
      'buyerName', buyer_name,
      'originStoreId', origin_store_id,
      'originStoreName', origin_store_name,
      'canProcess', can_process,
      'items', items
    ) order by activity_date desc, buyer_name, origin_store_name), '[]'::jsonb),
    'limit', greatest(1, least(coalesce(p_limit, 24), 100)),
    'offset', greatest(coalesce(p_offset, 0), 0),
    'hasMore', (select count(*) from group_rows) >
      greatest(coalesce(p_offset, 0), 0) + greatest(1, least(coalesce(p_limit, 24), 100))
  )
  into v_result
  from paged;

  return coalesce(v_result, jsonb_build_object(
    'groups', '[]'::jsonb,
    'limit', greatest(1, least(coalesce(p_limit, 24), 100)),
    'offset', greatest(coalesce(p_offset, 0), 0),
    'hasMore', false
  ));
end;
$$;

revoke all on function public.get_direct_store_fulfillment_groups(date, integer, integer)
from public, anon, service_role;
grant execute on function public.get_direct_store_fulfillment_groups(date, integer, integer)
to authenticated;

create or replace function public.get_operator_member_storage(
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with visible as (
    select
      i.id,
      i.member_id,
      pf.display_name as member_name,
      i.product_id,
      p.title,
      coalesce(p.image_urls[1], '') as image_url,
      i.origin_store_id,
      s.name as store_name,
      f.current_stage,
      f.outbound_released,
      i.storage_started_at,
      i.storage_expires_at,
      si.shipment_id,
      i.paid_at
    from public.customer_inventory_items i
    join public.profiles pf on pf.id = i.member_id
    join public.products p on p.id = i.product_id
    join public.stores s on s.id = i.origin_store_id
    join public.inventory_item_fulfillments f on f.inventory_item_id = i.id
    left join lateral (
      select x.shipment_id
      from public.inventory_shipment_items x
      where x.inventory_item_id = i.id
        and x.line_status not in ('excluded', 'cancelled')
      order by x.created_at desc
      limit 1
    ) si on true
    where i.ownership_status = 'active'
      and public.can_view_shared_fulfillment()
      and (public.is_owner() or public.has_store_permission(i.origin_store_id, 'prepare_orders'))
  ),
  paged as (
    select *
    from visible
    order by paid_at desc, id desc
    limit greatest(1, least(coalesce(p_limit, 100), 200))
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'inventoryItemId', id,
      'memberId', member_id,
      'memberName', member_name,
      'productId', product_id,
      'title', title,
      'imageUrl', image_url,
      'originStoreId', origin_store_id,
      'originStoreName', store_name,
      'fulfillmentStatus', case when outbound_released then 'stored' else 'waiting_outbound' end,
      'shipmentRequested', shipment_id is not null,
      'storageStartedAt', storage_started_at,
      'storageExpiresAt', storage_expires_at
    ) order by paid_at desc, id desc), '[]'::jsonb),
    'hasMore', (select count(*) from visible) >
      greatest(coalesce(p_offset, 0), 0) + greatest(1, least(coalesce(p_limit, 100), 200))
  )
  from paged;
$$;

revoke all on function public.get_operator_member_storage(integer, integer)
from public, anon, service_role;
grant execute on function public.get_operator_member_storage(integer, integer)
to authenticated;

create or replace function public.get_operator_winning_members(
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with visible as (
    select
      o.buyer_id as member_id,
      pf.display_name as member_name,
      o.id as payment_order_id,
      o.product_id,
      p.title,
      coalesce(p.image_urls[1], '') as image_url,
      p.store_id,
      s.name as store_name,
      o.expected_amount,
      o.status,
      o.requested_at
    from public.manual_transfer_orders o
    join public.profiles pf on pf.id = o.buyer_id
    join public.products p on p.id = o.product_id
    join public.stores s on s.id = p.store_id
    where o.status in ('awaiting_manual_transfer', 'confirmed')
      and public.can_view_shared_fulfillment()
      and (public.is_owner() or public.has_store_permission(p.store_id, 'prepare_orders'))
  ),
  grouped as (
    select
      member_id,
      member_name,
      count(*)::integer as item_count,
      sum(expected_amount)::bigint as total_amount,
      max(requested_at) as latest_won_at,
      jsonb_agg(jsonb_build_object(
        'paymentOrderId', payment_order_id,
        'productId', product_id,
        'title', title,
        'imageUrl', image_url,
        'originStoreId', store_id,
        'originStoreName', store_name,
        'amount', expected_amount,
        'paymentStatus', status
      ) order by requested_at desc, payment_order_id desc) as items
    from visible
    group by member_id, member_name
  ),
  paged as (
    select *
    from grouped
    order by latest_won_at desc, member_id
    limit greatest(1, least(coalesce(p_limit, 50), 100))
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'members', coalesce(jsonb_agg(jsonb_build_object(
      'memberId', member_id,
      'memberName', member_name,
      'itemCount', item_count,
      'totalAmount', total_amount,
      'latestWonAt', latest_won_at,
      'items', items
    ) order by latest_won_at desc, member_id), '[]'::jsonb),
    'hasMore', (select count(*) from grouped) >
      greatest(coalesce(p_offset, 0), 0) + greatest(1, least(coalesce(p_limit, 50), 100))
  )
  from paged;
$$;

revoke all on function public.get_operator_winning_members(integer, integer)
from public, anon, service_role;
grant execute on function public.get_operator_winning_members(integer, integer)
to authenticated;

-- Buyers only receive the public two-step delivery state. Internal collecting,
-- store release, packing, and fulfillment stages remain operator-only.
create or replace function public.get_my_inventory_shipments()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with v2 as (
  select sh.created_at as requested_at, jsonb_build_object(
    'id', sh.id,
    'sourceKind', 'inventory_v2',
    'sourceId', sh.id,
    'settlementMethod', sh.settlement_method,
    'shippingFeeStatus', case when sh.settlement_method = 'manual_transfer' then fp.status else 'confirmed' end,
    'publicStatus', case when sh.tracking_number is null then 'preparing' else 'shipped' end,
    'itemCount', (select count(*) from public.inventory_shipment_items where shipment_id = sh.id),
    'activeItemCount', (select count(*) from public.inventory_shipment_items
      where shipment_id = sh.id and line_status not in ('excluded', 'cancelled')),
    'courier', sh.courier,
    'trackingNumber', sh.tracking_number,
    'trackingUrl', case when sh.tracking_number ~ '^[0-9-]+$'
      then 'https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&schLang=KR&wblnumText2=' || sh.tracking_number end,
    'requestedAt', sh.created_at,
    'addressSnapshot', sh.address_snapshot,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
      'inventoryItemId', x.inventory_item_id,
      'productId', x.product_id,
      'title', p.title,
      'imageUrl', coalesce(p.image_urls[1], '')
    ) order by x.created_at, x.inventory_item_id), '[]'::jsonb)
      from public.inventory_shipment_items x
      join public.products p on p.id = x.product_id
      where x.shipment_id = sh.id)
  ) as payload
  from public.inventory_shipments sh
  left join public.shipping_fee_payments fp on fp.id = sh.shipping_fee_payment_id
  where sh.member_id = auth.uid()
    and exists(select 1 from public.inventory_fulfillment_rollout_settings rs
      where rs.business_id = sh.business_id and rs.unified_inventory_reads_enabled)
),
legacy as (
  select sh.created_at as requested_at, jsonb_build_object(
    'id', sh.id,
    'sourceKind', 'canonical_commerce',
    'sourceId', sh.id,
    'settlementMethod', sh.settlement_method,
    'shippingFeeStatus', case when sh.settlement_method = 'manual_transfer' then fp.status else 'confirmed' end,
    'publicStatus', case when sh.tracking_number is null then 'preparing' else 'shipped' end,
    'itemCount', (select count(*) from public.commerce_shipment_items where shipment_id = sh.id),
    'activeItemCount', (select count(*) from public.commerce_shipment_items where shipment_id = sh.id),
    'courier', sh.courier,
    'trackingNumber', sh.tracking_number,
    'trackingUrl', case when sh.tracking_number ~ '^[0-9-]+$'
      then 'https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&schLang=KR&wblnumText2=' || sh.tracking_number end,
    'requestedAt', sh.created_at,
    'addressSnapshot', sh.address_snapshot,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
      'inventoryItemId', ci.id,
      'productId', x.product_id,
      'title', p.title,
      'imageUrl', coalesce(p.image_urls[1], '')
    ) order by x.order_item_id), '[]'::jsonb)
      from public.commerce_shipment_items x
      join public.products p on p.id = x.product_id
      left join public.customer_inventory_items ci on ci.commerce_order_item_id = x.order_item_id
      where x.shipment_id = sh.id)
  ) as payload
  from public.commerce_shipments sh
  left join public.shipping_fee_payments fp on fp.id = sh.shipping_fee_payment_id
  where sh.member_id = auth.uid()
)
select jsonb_build_object(
  'shipments', coalesce(jsonb_agg(payload order by requested_at desc), '[]'::jsonb)
)
from (select * from v2 union all select * from legacy) all_shipments;
$$;

revoke all on function public.get_my_inventory_shipments()
from public, anon, service_role;
grant execute on function public.get_my_inventory_shipments()
to authenticated;

commit;
