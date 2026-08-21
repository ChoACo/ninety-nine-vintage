begin;

-- Owner/operator server routes read these store-scoped tables directly with
-- the admin client (operator-authenticated, filtered by the selected store or
-- acting member). The platform hardening pass stripped data privileges from
-- service_role on them, which made 판매센터 거래내역 and MY 보관함 load fail
-- with 403. Restore read access only; writes stay behind RPCs.
grant select on public.store_settlement_entries to service_role;
grant select on public.store_settlement_batches to service_role;
grant select on public.shipping_fee_waiver_entitlements to service_role;
grant select on public.businesses to service_role;

commit;
