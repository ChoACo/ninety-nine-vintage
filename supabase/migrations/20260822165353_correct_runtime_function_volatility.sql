begin;

alter function public.require_active_operator_store_scope() volatile;
alter function public.get_pending_inventory_delivery_tracking(integer) volatile;

commit;
