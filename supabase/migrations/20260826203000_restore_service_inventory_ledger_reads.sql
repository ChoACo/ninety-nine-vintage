begin;

-- These fulfillment tables intentionally deny direct browser access. The
-- trusted server client still needs read-only access so Owner-only APIs can
-- assemble the audited global member ledger.
grant select on table public.inventory_shipments to service_role;
grant select on table public.inventory_shipment_items to service_role;
grant select on table public.inventory_item_fulfillments to service_role;

commit;
