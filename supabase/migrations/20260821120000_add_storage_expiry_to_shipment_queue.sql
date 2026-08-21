begin;

-- The operator shipping queue now carries the earliest storage deadline among
-- active lines so the console can badge D-Day urgency and filter expiring
-- shipments without extra queries. Masking and store scoping are unchanged.
create or replace function public.get_inventory_shipment_queue(
  p_include_shipped boolean default false,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_shipments jsonb;
  v_completed jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = '택배 신청 조회 권한이 없습니다.';
  end if;

  perform public.refresh_inventory_delivery_history();

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', shipments.id,
    'memberId', shipments.member_id,
    'memberName', case
      when char_length(profiles.display_name) <= 1 then '*'
      else left(profiles.display_name, 1) || repeat('*', least(char_length(profiles.display_name) - 1, 3))
    end,
    'businessId', shipments.business_id,
    'status', shipments.status,
    'version', shipments.version,
    'settlementMethod', shipments.settlement_method,
    'shippingFeeStatus', case
      when shipments.settlement_method = 'manual_transfer' then payments.status
      else 'confirmed'
    end,
    'requestedAt', shipments.created_at,
    'packedAt', shipments.packed_at,
    'shippedAt', shipments.shipped_at,
    'courier', shipments.courier,
    'trackingNumber', shipments.tracking_number,
    'addressSnapshot', jsonb_build_object(
      'label', coalesce(shipments.address_snapshot ->> 'label', '배송지'),
      'recipientName', '작업 시 확인',
      'phone', '***-****-****',
      'postalCode', null,
      'address', '작업 시 확인'
    ),
    'itemCount', (select count(*) from public.inventory_shipment_items x where x.shipment_id = shipments.id),
    'activeItemCount', (select count(*) from public.inventory_shipment_items x where x.shipment_id = shipments.id and x.line_status not in ('excluded', 'cancelled')),
    'releasedItemCount', (select count(*) from public.inventory_shipment_items x join public.inventory_item_fulfillments f on f.inventory_item_id = x.inventory_item_id where x.shipment_id = shipments.id and x.line_status not in ('excluded', 'cancelled') and f.outbound_released),
    'unreleasedItemCount', (select count(*) from public.inventory_shipment_items x join public.inventory_item_fulfillments f on f.inventory_item_id = x.inventory_item_id where x.shipment_id = shipments.id and x.line_status not in ('excluded', 'cancelled') and not f.outbound_released),
    'heldItemCount', (select count(*) from public.inventory_shipment_items x where x.shipment_id = shipments.id and x.line_status = 'held'),
    'storageExpiresAt', (
      select min(stored_items.storage_expires_at)
      from public.inventory_shipment_items active_lines
      join public.customer_inventory_items stored_items on stored_items.id = active_lines.inventory_item_id
      where active_lines.shipment_id = shipments.id
        and active_lines.line_status not in ('excluded', 'cancelled')
        and stored_items.storage_expires_at is not null
    ),
    'storageDurationDays', (
      select stored_items.storage_duration_days
      from public.inventory_shipment_items active_lines
      join public.customer_inventory_items stored_items on stored_items.id = active_lines.inventory_item_id
      where active_lines.shipment_id = shipments.id
        and active_lines.line_status not in ('excluded', 'cancelled')
        and stored_items.storage_expires_at is not null
      order by stored_items.storage_expires_at asc, active_lines.inventory_item_id asc
      limit 1
    ),
    'storeWorks', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', works.id, 'storeId', works.origin_store_id, 'storeName', stores.name,
      'status', works.status, 'version', works.version
    ) order by stores.name, works.origin_store_id), '[]'::jsonb)
      from public.inventory_shipment_store_works works
      join public.stores stores on stores.id = works.origin_store_id
      where works.shipment_id = shipments.id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
      'inventoryItemId', shipment_items.inventory_item_id,
      'productId', shipment_items.product_id,
      'title', products.title,
      'imageUrl', coalesce(products.image_urls[1], ''),
      'lineStatus', shipment_items.line_status,
      'released', fulfillments.outbound_released,
      'originStoreId', shipment_items.origin_store_id,
      'originStoreName', stores.name,
      'isBlocked', fulfillments.is_blocked
    ) order by stores.name, shipment_items.created_at, shipment_items.inventory_item_id), '[]'::jsonb)
      from public.inventory_shipment_items shipment_items
      join public.products products on products.id = shipment_items.product_id
      join public.inventory_item_fulfillments fulfillments on fulfillments.inventory_item_id = shipment_items.inventory_item_id
      join public.stores stores on stores.id = shipment_items.origin_store_id
      where shipment_items.shipment_id = shipments.id)
  ) order by shipments.created_at desc, shipments.id desc), '[]'::jsonb)
  into v_shipments
  from (
    select candidate.*
    from public.inventory_shipments candidate
    where candidate.delivery_completed_at is null
      and (p_include_shipped or candidate.status <> 'shipped')
      and app_private.can_access_inventory_shipment(candidate.id, 'create_shipments', v_actor)
    order by candidate.created_at desc, candidate.id desc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    offset greatest(coalesce(p_offset, 0), 0)
  ) shipments
  join public.profiles profiles on profiles.id = shipments.member_id
  left join public.shipping_fee_payments payments on payments.id = shipments.shipping_fee_payment_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'shipmentId', history.shipment_id,
    'memberId', history.member_id,
    'memberName', case when char_length(history.member_name) <= 1 then '*' else left(history.member_name, 1) || '**' end,
    'courier', history.courier,
    'trackingNumber', history.tracking_number,
    'itemCount', history.item_count,
    'products', history.product_summaries,
    'shippedAt', history.shipped_at,
    'completedAt', history.completed_at,
    'purgeAfter', history.purge_after
  ) order by history.completed_at desc, history.shipment_id desc), '[]'::jsonb)
  into v_completed
  from (
    select candidate.*
    from public.inventory_delivery_history candidate
    where app_private.can_access_inventory_shipment(candidate.shipment_id, 'create_shipments', v_actor)
    order by candidate.completed_at desc, candidate.shipment_id desc
    limit 500
  ) history;

  return jsonb_build_object(
    'shipments', coalesce(v_shipments, '[]'::jsonb),
    'completedDeliveries', coalesce(v_completed, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_inventory_shipment_queue(boolean, integer, integer)
from public, anon, service_role;
grant execute on function public.get_inventory_shipment_queue(boolean, integer, integer)
to authenticated;

commit;
