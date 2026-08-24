begin;

-- The account shipments API authenticates the member first, scopes the query
-- to that member and to shipment IDs returned by get_my_inventory_shipments,
-- then enriches the public RPC payload with these delivery-only fields.
grant select (
  id,
  member_id,
  delivery_status,
  delivery_status_text,
  delivered_at,
  auto_settle_at
) on table public.inventory_shipments to service_role;

commit;
