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
      items.id,
      items.member_id,
      profiles.display_name as member_name,
      items.product_id,
      products.title,
      coalesce(products.image_urls[1], '') as image_url,
      items.origin_store_id,
      stores.name as store_name,
      fulfillments.outbound_released,
      items.storage_started_at,
      items.storage_expires_at,
      items.paid_at
    from public.customer_inventory_items items
    join public.profiles profiles on profiles.id = items.member_id
    join public.products products on products.id = items.product_id
    join public.stores stores on stores.id = items.origin_store_id
    join public.inventory_item_fulfillments fulfillments on fulfillments.inventory_item_id = items.id
    where items.ownership_status = 'active'
      and public.can_view_shared_fulfillment()
      and not exists (
        select 1 from public.inventory_shipment_items shipment_items
        where shipment_items.inventory_item_id = items.id
          and shipment_items.line_status not in ('excluded', 'cancelled')
      )
  ), paged as (
    select * from visible
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
      'shipmentRequested', false,
      'storageStartedAt', storage_started_at,
      'storageExpiresAt', storage_expires_at,
      'paidAt', paid_at
    ) order by paid_at desc, id desc), '[]'::jsonb),
    'hasMore', (select count(*) from visible) > greatest(coalesce(p_offset, 0), 0) + greatest(1, least(coalesce(p_limit, 100), 200))
  ) from paged;
$$;

revoke all on function public.get_operator_member_storage(integer, integer) from public, anon, service_role;
grant execute on function public.get_operator_member_storage(integer, integer) to authenticated;
