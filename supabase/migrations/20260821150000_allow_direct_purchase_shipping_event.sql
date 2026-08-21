begin;

-- Direct fixed-price checkout creates a shipment before fulfillment begins.
-- Keep that event distinct from a member-requested shipment while allowing it
-- through the append-only event contract.
alter table public.inventory_shipment_events
  drop constraint if exists inventory_shipment_events_event_type_check;

alter table public.inventory_shipment_events
  add constraint inventory_shipment_events_event_type_check
  check (event_type in (
    'requested', 'direct_purchase_shipping_requested',
    'store_items_released', 'ready_to_pack', 'packed', 'shipped',
    'line_held', 'line_resumed', 'line_excluded', 'cancelled',
    'reconciliation_required', 'tracking_updated', 'tracking_deleted'
  ));

commit;
