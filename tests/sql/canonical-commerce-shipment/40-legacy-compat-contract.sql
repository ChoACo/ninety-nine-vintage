-- FIX 1 legacy-only compatibility contract.  Runs after
-- 20260808000000_retire_commerce_shipment_writes.sql in the canonical chain,
-- which deliberately does NOT apply the unified-inventory v2 migrations.  These
-- tests prove the read/command surface the retirement migration installs:
--   * a paid, unshipped, unmapped order is the only eligible "legacy row";
--   * paid-but-unpaid-item, order-status, expired-storage, and already-shipped
--     orders are all ineligible;
--   * the command fails closed (55000) while request_inventory_shipment and the
--     v2 tables are absent, instead of guessing or writing legacy rows;
--   * no other member can see or act on the owner's legacy rows;
--   * the compat read/command are authenticated-only surface.
--
-- Row-state coverage across the whole compatibility layer:
--   * legacy row  - paid/unshipped/unmapped commerce order.  Executed below and
--                   guarded statically in tests/core/legacy-order-shipment-compat.test.mjs.
--   * v2 row      - order item already converted to a customer_inventory_items
--                   entitlement; excluded from the eligible read and rejected by
--                   the command.  The tables do not exist in this canonical
--                   chain, so the exclusion is asserted statically against the
--                   migration in tests/core (customer_inventory_items mapper).
--   * linked row  - legacy commerce_shipments history that has v2 inventory
--                   shipments attached through
--                   customer_inventory_items.legacy_commerce_shipment_id; exposed
--                   as linkedInventoryShipmentIds by app_private.get_commerce_shipment_compat.
--                   Verified by the adapter assertions in 30-retire-writes.sql and
--                   statically in tests/core.
--   * unmapped row- a legacy shipment with no v2 link yet; linkedInventoryShipmentIds
--                   must be an empty array.  Verified by the 30-retire-writes.sql
--                   adapter assertions (v2 tables absent) and statically in tests/core.

-- ---------------------------------------------------------------------------
-- Fixtures: one eligible order plus three ineligible orders for the same
-- member.  Order 6 uses the pre-retirement canonical helper; the ineligible
-- orders are inserted directly because they intentionally violate the item /
-- order state invariants that the compatibility read enforces.
-- ---------------------------------------------------------------------------

select test_support.create_paid_center_stored_order(6);

insert into public.products (id, store_id, title)
values ('30000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000001', 'Legacy unpaid item');
insert into public.commerce_orders (id, member_id, status, total)
values ('40000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000006', 'paid', 10000);
insert into public.commerce_order_items (id, order_id, product_id, store_id, unit_price, payment_status, storage_expires_at)
values ('50000000-0000-4000-8000-000000000007', '40000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000001', 10000, 'awaiting_payment', clock_timestamp() + interval '7 days');

insert into public.products (id, store_id, title)
values ('30000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000001', 'Legacy unpaid order');
insert into public.commerce_orders (id, member_id, status, total)
values ('40000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000006', 'awaiting_payment', 10000);
insert into public.commerce_order_items (id, order_id, product_id, store_id, unit_price, payment_status, storage_expires_at)
values ('50000000-0000-4000-8000-000000000008', '40000000-0000-4000-8000-000000000008', '30000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000001', 10000, 'awaiting_payment', clock_timestamp() + interval '7 days');

insert into public.products (id, store_id, title)
values ('30000000-0000-4000-8000-000000000009', '20000000-0000-4000-8000-000000000001', 'Legacy expired item');
insert into public.commerce_orders (id, member_id, status, total)
values ('40000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000006', 'paid', 10000);
insert into public.commerce_order_items (id, order_id, product_id, store_id, unit_price, payment_status, storage_expires_at)
values ('50000000-0000-4000-8000-000000000009', '40000000-0000-4000-8000-000000000009', '30000000-0000-4000-8000-000000000009', '20000000-0000-4000-8000-000000000001', 10000, 'paid', clock_timestamp() - interval '1 day');

-- ---------------------------------------------------------------------------
-- Compat read: eligible legacy row appears, every ineligible row is excluded,
-- and the read is strictly member-scoped.
-- ---------------------------------------------------------------------------

set role authenticated;
select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000006', false);
select test_support.assert_true(
  (
    select jsonb_array_length(v_result -> 'orders') = 1
      and (v_result -> 'orders' -> 0 ->> 'sourceId')::uuid = '40000000-0000-4000-8000-000000000006'
      and (v_result -> 'orders' -> 0 ->> 'requestEligible')::boolean
      and jsonb_array_length(v_result -> 'orders' -> 0 -> 'items') = 1
      and (v_result -> 'orders' -> 0 ->> 'storageExpiresAt')::timestamptz > clock_timestamp()
    from (select public.get_my_legacy_eligible_orders() as v_result) as view
  ),
  'compat read must surface exactly the eligible legacy order with one paid item'
);
select test_support.assert_true(
  (
    select not exists (
      select 1
      from jsonb_array_elements(public.get_my_legacy_eligible_orders() -> 'orders') as entry
      where (entry ->> 'sourceId')::uuid in (
        '40000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000007',
        '40000000-0000-4000-8000-000000000008',
        '40000000-0000-4000-8000-000000000009'
      )
    )
  ),
  'compat read must exclude shipped, unpaid-item, unpaid-order, and expired orders'
);

select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000001', false);
select test_support.assert_true(
  (
    select jsonb_array_length(public.get_my_legacy_eligible_orders() -> 'orders') = 0
  ),
  'compat read must return nothing for a member with no legacy rows'
);
reset role;
select set_config('app.test_user_id', '', false);

-- ---------------------------------------------------------------------------
-- Compat command: on the canonical chain the unified inventory does not exist,
-- so every legacy request fails closed instead of writing a legacy row.
-- ---------------------------------------------------------------------------

set role authenticated;
select set_config('app.test_user_id', '10000000-0000-4000-8000-000000000006', false);
select test_support.expect_sqlstate(
  $$select public.request_legacy_order_shipment(
    '40000000-0000-4000-8000-000000000006',
    '60000000-0000-4000-8000-000000000001',
    true,
    '81000000-0000-4000-8000-000000000001'
  )$$,
  '55000',
  'legacy request must fail closed while the unified inventory is inactive'
);
select test_support.expect_sqlstate(
  $$select public.request_legacy_order_shipment(
    '99999999-0000-4000-8000-000000000000',
    '60000000-0000-4000-8000-000000000001',
    true,
    '81000000-0000-4000-8000-000000000002'
  )$$,
  '55000',
  'legacy request must fail closed before any order lookup'
);
reset role;
select set_config('app.test_user_id', '', false);
select test_support.assert_true(
  not exists (
    select 1 from public.shipping_requests
    where idempotency_key = '81000000-0000-4000-8000-000000000001'
  )
  and not exists (
    select 1 from public.commerce_shipment_orders
    where order_id = '40000000-0000-4000-8000-000000000006'
  ),
  'fail-closed legacy requests must never write a shipping_request or shipment'
);

-- ---------------------------------------------------------------------------
-- Surface boundaries: the compat read and command are authenticated-only.
-- ---------------------------------------------------------------------------

select test_support.assert_true(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.get_my_legacy_eligible_orders()', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'public.get_my_legacy_eligible_orders()', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role', 'public.get_my_legacy_eligible_orders()', 'EXECUTE'
  ),
  'compat read must be an authenticated-only surface'
);
select test_support.assert_true(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.request_legacy_order_shipment(uuid,uuid,boolean,uuid)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'public.request_legacy_order_shipment(uuid,uuid,boolean,uuid)', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role', 'public.request_legacy_order_shipment(uuid,uuid,boolean,uuid)', 'EXECUTE'
  ),
  'compat command must be an authenticated-only surface'
);
