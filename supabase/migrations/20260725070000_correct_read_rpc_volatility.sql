begin;

-- These functions intentionally use volatile helpers such as
-- clock_timestamp(), or call a manifest validator that must see the latest
-- statement state. Mark the full call chain VOLATILE so PostgreSQL does not
-- reuse a stale STABLE snapshot or make an unsafe planner assumption.
alter function app_private.commerce_shipment_gate(uuid, text) volatile;
alter function public.get_commerce_shipment_queue(boolean, integer, integer) volatile;
alter function public.get_store_financial_report(date, date) volatile;
alter function public.get_owner_withdrawn_member_retention(integer, integer) volatile;

commit;
