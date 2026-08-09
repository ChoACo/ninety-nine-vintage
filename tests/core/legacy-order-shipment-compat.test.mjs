import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");
const migrationPath =
  "supabase/migrations/20260808000000_retire_commerce_shipment_writes.sql";
const sqlContractPath =
  "tests/sql/canonical-commerce-shipment/40-legacy-compat-contract.sql";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sqlFunction(sql, name, schema = "public") {
  const startPattern = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+${escapeRegExp(schema)}\\.${escapeRegExp(name)}\\s*\\(`,
    "i",
  );
  const match = startPattern.exec(sql);
  assert.ok(match, `${schema}.${name} must be declared`);
  const end = sql.indexOf("$$;", match.index);
  assert.notEqual(end, -1, `${schema}.${name} must have a closed dollar body`);
  return sql.slice(match.index, end + 3);
}

test("legacy shipment compat read + command + helper API are declared in the retirement migration", async () => {
  const migration = await source(migrationPath);
  const helper = sqlFunction(migration, "get_commerce_shipment_compat", "app_private");
  const read = sqlFunction(migration, "get_my_legacy_eligible_orders");
  const command = sqlFunction(migration, "request_legacy_order_shipment");
  const compatApi = sqlFunction(migration, "get_my_commerce_shipment_compat");

  assert.match(helper, /sourceKind.*canonical_commerce/);
  assert.match(helper, /linkedInventoryShipmentIds/);
  assert.match(helper, /to_regclass\('public\.customer_inventory_items'\)/);
  assert.match(helper, /to_regclass\('public\.inventory_shipment_items'\)/);

  for (const fn of [read, command, compatApi]) {
    assert.match(fn, /security\s+definer/i);
    assert.match(fn, /set\s+search_path\s*=\s*''/);
  }
});

test("get_my_legacy_eligible_orders is a member-scoped paid/unshipped/unmapped read with authenticated-only execute", async () => {
  const migration = await source(migrationPath);
  const fn = sqlFunction(migration, "get_my_legacy_eligible_orders");

  assert.match(fn, /language\s+plpgsql/i);
  assert.match(fn, /stable/i);
  assert.match(fn, /auth\.uid\(\)/);
  assert.match(fn, /orders\.member_id\s*=\s*v_member/);

  // eligible state requires every item paid, unexpired, unshipped, unmapped
  assert.match(fn, /orders\.status\s*=\s*'paid'/);
  assert.match(fn, /invalid_item\.payment_status\s*<>\s*'paid'/);
  assert.match(fn, /invalid_item\.storage_expires_at\s+is\s+null/);
  assert.match(fn, /invalid_item\.storage_expires_at\s*<=\s*clock_timestamp\(\)/);
  assert.match(fn, /public\.commerce_shipment_items\s+shipped_item/);
  assert.match(fn, /public\.customer_inventory_items\s+mapped_item/);
  assert.match(fn, /item\.id\s*=\s*mapped_item\.commerce_order_item_id/);
  assert.match(fn, /to_regclass\('public\.customer_inventory_items'\)/);
  assert.match(fn, /'sourceKind',\s*'canonical_commerce'/);
  assert.match(fn, /'requestEligible',\s*true/);

  assert.match(migration, /grant\s+execute\s+on\s+function\s+public\.get_my_legacy_eligible_orders\(\)\s+to\s+authenticated/);
  assert.doesNotMatch(
    migration,
    /grant\s+execute\s+on\s+function\s+public\.get_my_legacy_eligible_orders\(\)[^;]*(?:anon|service_role)\s*;/i,
  );
});

test("request_legacy_order_shipment fails closed pre-cutover and enforces request-eligible / ineligible states", async () => {
  const migration = await source(migrationPath);
  const fn = sqlFunction(migration, "request_legacy_order_shipment");

  // pre-unified-inventory schemas must refuse instead of guessing
  assert.match(fn, /to_regprocedure\('public\.request_inventory_shipment\(uuid\[\],uuid,text,bigint,text,text,uuid\)'\)\s+is\s+null/);
  assert.match(fn, /errcode\s*=\s*'55000'/);

  // member + ownership gate
  assert.match(fn, /auth\.uid\(\)/);
  assert.match(fn, /public\.is_member\(\)/);
  assert.match(fn, /orders\.member_id\s+into\s+v_member/);
  assert.match(fn, /v_member\s+is\s+distinct\s+from\s+v_actor/);

  // ineligible: unpaid / expired / already shipped / already mapped
  assert.match(fn, /item\.payment_status\s*=\s*'paid'/);
  assert.match(fn, /invalid_item\.payment_status\s*<>\s*'paid'/);
  assert.match(fn, /invalid_item\.storage_expires_at\s*<=\s*clock_timestamp\(\)/);
  assert.match(fn, /commerce_shipment_items\s+shipped_item/);
  assert.match(fn, /customer_inventory_items\s+mapped_item/);

  // verified conversion keeps legacy facts in the unified ledger only
  assert.match(fn, /set_config\('app\.inventory_entitlement_backfill',\s*'1',\s*true\)/);
  assert.match(fn, /app_private\.create_customer_inventory_entitlement\('commerce',\s*v_order_item\.id\)/);
  assert.match(fn, /public\.request_inventory_shipment\(\s*v_item_ids,\s*p_address_id,\s*v_method,\s*null,\s*null,\s*null,\s*p_idempotency_key\s*\)/);

  assert.match(
    migration,
    /grant\s+execute\s+on\s+function\s+public\.request_legacy_order_shipment\(\s*uuid,\s*uuid,\s*boolean,\s*uuid\s*\)\s+to\s+authenticated/,
  );
  assert.doesNotMatch(
    migration,
    /grant\s+execute\s+on\s+function\s+public\.request_legacy_order_shipment\([^;]*(?:anon|service_role)\s*;/i,
  );
});

test("get_my_commerce_shipment_compat wires the helper through a member-ownership read", async () => {
  const migration = await source(migrationPath);
  const fn = sqlFunction(migration, "get_my_commerce_shipment_compat");

  assert.match(fn, /app_private\.get_commerce_shipment_compat\(p_shipment_id\)/);
  assert.match(fn, /memberId/);
  assert.match(fn, /auth\.uid\(\)::text/);

  assert.match(
    migration,
    /grant\s+execute\s+on\s+function\s+public\.get_my_commerce_shipment_compat\(uuid\)\s+to\s+authenticated/,
  );
  assert.doesNotMatch(
    migration,
    /grant\s+execute\s+on\s+function\s+public\.get_my_commerce_shipment_compat\([^;]*(?:anon|service_role)\s*;/i,
  );
});

test("the compat helper and its new read APIs are wired to real server routes", async () => {
  const [
    eligibleOrdersRoute,
    legacyOrderRoute,
    shipmentsIdRoute,
    shipmentsRoute,
    dashboard,
  ] = await Promise.all([
    source("src/app/api/account/legacy-eligible-orders/route.ts"),
    source("src/app/api/shipping/requests/legacy-order/route.ts"),
    source("src/app/api/account/shipments/[id]/route.ts"),
    source("src/app/api/account/shipments/route.ts"),
    source("src/components/features/account/AccountDashboard.tsx"),
  ]);

  assert.match(eligibleOrdersRoute, /authenticateMemberCommerceRequest/);
  assert.match(eligibleOrdersRoute, /get_my_legacy_eligible_orders/);
  assert.match(eligibleOrdersRoute, /legacy_orders_unavailable/);

  assert.match(legacyOrderRoute, /authenticateMemberCommerceRequest\(request,\s*true\)/);
  assert.match(legacyOrderRoute, /request_legacy_order_shipment/);
  assert.match(legacyOrderRoute, /p_order_id/);
  assert.match(legacyOrderRoute, /p_address_id/);
  assert.match(legacyOrderRoute, /p_apply_shipping_credit/);
  assert.match(legacyOrderRoute, /p_idempotency_key/);

  assert.match(shipmentsIdRoute, /authenticateMemberCommerceRequest/);
  assert.match(shipmentsIdRoute, /get_my_commerce_shipment_compat/);
  assert.match(shipmentsIdRoute, /p_shipment_id/);
  assert.match(shipmentsIdRoute, /shipment_not_found/);
  assert.match(shipmentsIdRoute, /immutable/);
  assert.match(shipmentsIdRoute, /linkedInventoryShipmentIds/);

  // the legacy history read stays on the existing shipments route
  assert.match(shipmentsRoute, /get_my_inventory_shipments/);

  // FIX 1 dashboard restores a read-only eligible-order surface plus a distinct
  // compatibility request command; the retired orderId body stays 410 on v2.
  assert.match(dashboard, /\/api\/account\/legacy-eligible-orders/);
  assert.match(dashboard, /\/api\/shipping\/requests\/legacy-order/);
  assert.match(dashboard, /legacyEligibleOrders/);
  assert.match(dashboard, /selectedOrderId/);
  assert.match(dashboard, /"legacy"\s*:/);
});

test("tests/sql legacy compat contract covers legacy, v2, linked, and unmapped row states", async () => {
  const contract = await source(sqlContractPath);
  for (const expected of [
    /legacy row/,
    /v2 row/,
    /linked row/,
    /unmapped row/,
    /get_my_legacy_eligible_orders/,
    /request_legacy_order_shipment/,
    /linkedInventoryShipmentIds/,
  ]) {
    assert.match(contract, expected);
  }
});
