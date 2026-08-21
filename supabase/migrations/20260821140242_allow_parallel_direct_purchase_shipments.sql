begin;

-- A direct purchase owns its checkout-time address snapshot and creates its
-- own outbound shipment. The older member-requested shipment invariant allows
-- only one active store unit, so exclude purchase-included shipments from that
-- invariant instead of merging separate orders and addresses.
drop index if exists public.inventory_shipments_one_active_store_unit_idx;

create unique index inventory_shipments_one_active_store_unit_idx
on public.inventory_shipments (member_id, unit_store_id)
where unit_kind = 'store'
  and status not in ('shipped', 'cancelled')
  and settlement_method <> 'purchase_included';

comment on index public.inventory_shipments_one_active_store_unit_idx is
  'One active member-requested shipment per member/store; direct purchases remain order-address scoped.';

commit;
