begin;

-- The direct-store cutover replaced the center-scoped queue function, but the
-- shipment mutation RPCs still need one database-level permission boundary.
-- Status refreshes remain available to the buyer flow; packing, shipping, and
-- tracking changes require the shipment permission.
create or replace function app_private.assert_inventory_shipment_mutation_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    new.status in ('packed', 'shipped')
    or old.status in ('packed', 'shipped')
    or old.courier is distinct from new.courier
    or old.tracking_number is distinct from new.tracking_number
  )
  and not (
    public.is_owner()
    or public.has_business_permission(new.business_id, 'create_shipments')
    or app_private.has_center_permission(new.fulfillment_center_id, 'create_shipments')
  )
  then
    raise exception using
      errcode = '42501',
      message = '택배 발송 권한이 없습니다.';
  end if;

  return new;
end;
$$;

drop trigger if exists inventory_shipments_mutation_gate
  on public.inventory_shipments;
create trigger inventory_shipments_mutation_gate
before update on public.inventory_shipments
for each row
execute function app_private.assert_inventory_shipment_mutation_gate();

revoke all on function app_private.assert_inventory_shipment_mutation_gate()
from public, anon, authenticated, service_role;

commit;
