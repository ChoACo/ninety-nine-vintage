-- Owner dashboard projection for shipped inventory. Unified inventory tables
-- remain RPC-only; this function exposes only the store and shipment timestamp
-- needed for the 14-day flow chart.
create or replace function public.get_owner_shipped_inventory_flow(
  p_from timestamptz,
  p_store_id uuid default null
)
returns table (
  origin_store_id uuid,
  shipped_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.access_role_for_user(auth.uid()) <> 'owner' then
    raise exception using
      errcode = '42501',
      message = '소유자 권한이 필요합니다.';
  end if;
  if p_from is null then
    raise exception using
      errcode = '22023',
      message = '조회 시작 시각을 확인해 주세요.';
  end if;

  return query
  select
    shipment_items.origin_store_id,
    shipments.shipped_at
  from public.inventory_shipment_items as shipment_items
  join public.inventory_shipments as shipments
    on shipments.id = shipment_items.shipment_id
  where shipment_items.line_status = 'shipped'
    and shipments.shipped_at >= p_from
    and (p_store_id is null or shipment_items.origin_store_id = p_store_id)
  order by shipments.shipped_at desc;
end;
$$;

revoke all on function public.get_owner_shipped_inventory_flow(timestamptz, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_owner_shipped_inventory_flow(timestamptz, uuid)
to authenticated;

comment on function public.get_owner_shipped_inventory_flow(timestamptz, uuid) is
  'Owner-only minimal shipped inventory projection for platform and per-store dashboard flow analytics';
