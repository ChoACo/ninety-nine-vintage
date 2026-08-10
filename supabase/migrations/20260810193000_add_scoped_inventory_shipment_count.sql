create or replace function public.count_inventory_shipment_queue(
  p_include_shipped boolean default false
)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select count(*)::bigint
  from public.inventory_shipments candidate
  where candidate.delivery_completed_at is null
    and (p_include_shipped or candidate.status <> 'shipped')
    and app_private.can_access_inventory_shipment(candidate.id, 'create_shipments', auth.uid());
$$;

revoke all on function public.count_inventory_shipment_queue(boolean)
from public, anon, service_role;
grant execute on function public.count_inventory_shipment_queue(boolean)
to authenticated;
