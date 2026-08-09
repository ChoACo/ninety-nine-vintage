-- New stores use direct-store fulfillment and no longer require a configured
-- central fulfillment center. Keep the legacy functions and tables for
-- historical records, but detach the two statement triggers that otherwise
-- reject checkout and payment when a store has no default center.

begin;

drop trigger if exists commerce_order_items_initialize_fulfillment
  on public.commerce_order_items;

drop trigger if exists commerce_order_items_sync_payment_fulfillment
  on public.commerce_order_items;

comment on function app_private.initialize_commerce_fulfillment() is
  'Historical central-fulfillment initializer. Detached after the direct-store checkout cutover.';

comment on function app_private.sync_commerce_payment_fulfillment() is
  'Historical central-fulfillment payment projection. Detached after the direct-store checkout cutover.';

commit;
