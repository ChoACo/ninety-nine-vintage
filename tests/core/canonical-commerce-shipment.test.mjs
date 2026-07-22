import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("canonical shipment schema binds one immutable manifest to exact settlement evidence", async () => {
  const migration = await source(
    "supabase/migrations/20260722060000_add_canonical_commerce_shipments.sql",
  );

  for (const table of [
    "commerce_shipments",
    "commerce_shipment_orders",
    "commerce_shipment_items",
    "commerce_shipment_events",
    "commerce_shipment_reconciliation_cases",
  ]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`, "i"));
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} force row level security`, "i"),
    );
  }
  assert.match(migration, /validate_commerce_shipment_manifest/i);
  assert.match(migration, /commerce_shipments_manifest_complete/i);
  assert.match(migration, /shipping_requests_require_classification/i);
  assert.match(migration, /shipping_fee_payments_one_request_idx/i);
  assert.match(migration, /shipping_credit_ledger_one_request_usage_idx/i);
  assert.match(migration, /commerce_shipment_events_append_only/i);
  assert.match(
    migration,
    /settlement_method = 'shipping_credit'[\s\S]*shipping_credit_ledger_id is not null[\s\S]*shipping_fee_payment_id is null/i,
  );
  assert.match(
    migration,
    /settlement_method = 'manual_transfer'[\s\S]*shipping_fee_payment_id is not null[\s\S]*shipping_credit_ledger_id is null/i,
  );
  assert.match(
    migration,
    /revoke all privileges on table[\s\S]*public\.commerce_shipments[\s\S]*from public, anon, authenticated, service_role/i,
  );
});

test("canonical shipment commands enforce complete-order CAS packing and one tracking dispatch", async () => {
  const migration = await source(
    "supabase/migrations/20260722070000_activate_canonical_commerce_shipments.sql",
  );

  assert.match(migration, /create or replace function public\.request_commerce_order_shipment/i);
  assert.match(migration, /grant execute on function public\.request_commerce_order_shipment[\s\S]*to service_role/i);
  assert.match(migration, /select count\(\*\)[\s\S]*commerce_shipment_orders[\s\S]*<> 1/i);
  assert.match(migration, /create or replace function public\.pack_commerce_shipment/i);
  assert.match(migration, /p_expected_version bigint/i);
  assert.match(migration, /p_idempotency_key uuid/i);
  assert.match(migration, /v_gate_status <> 'ready_to_pack'/i);
  assert.match(migration, /create or replace function public\.ship_commerce_shipment/i);
  assert.match(migration, /v_gate_status <> 'ready_to_ship'/i);
  assert.match(migration, /commerce_shipments_tracking_key/i);
  assert.match(migration, /create or replace function public\.correct_commerce_shipment_tracking/i);
  assert.match(migration, /not public\.is_owner\(\)/i);
  assert.doesNotMatch(migration, /\bmin\(fulfillment\.business_id\)/i);

  for (const legacyFunction of [
    "request_product_shipping",
    "mark_shipping_request_shipped",
    "upsert_shipping_tracking_batch",
    "get_shipping_work",
    "owner_request_hidden_test_shipping",
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${legacyFunction}`, "i"),
    );
  }
});

test("shipping API exposes only canonical shipment RPC write paths", async () => {
  const [memberRoute, operatorRoute, ownerRoute, hiddenTestRoute] =
    await Promise.all([
      source("src/app/api/shipping/requests/route.ts"),
      source("src/app/api/admin/operator/shipping/route.ts"),
      source("src/app/api/admin/owner/shipping/[id]/route.ts"),
      source("src/app/api/admin/owner/test-member/shipping/route.ts"),
    ]);

  assert.match(memberRoute, /"request_commerce_order_shipment"/);
  assert.match(memberRoute, /p_order_id:\s*body\.orderId/);
  assert.match(memberRoute, /p_member_id:\s*auth\.userId/);
  assert.doesNotMatch(memberRoute, /productIds|request_product_shipping/);
  assert.doesNotMatch(memberRoute, /\.from\("shipping_fee_payments"\)/);

  assert.match(operatorRoute, /"get_commerce_shipment_queue"/);
  assert.match(operatorRoute, /"pack_commerce_shipment"/);
  assert.match(operatorRoute, /"ship_commerce_shipment"/);
  assert.match(operatorRoute, /p_expected_version:\s*body\.expectedVersion/);
  assert.match(operatorRoute, /p_idempotency_key:\s*body\.idempotencyKey/);
  assert.doesNotMatch(operatorRoute, /mark_shipping_request_shipped|get_shipping_work/);

  assert.match(ownerRoute, /"correct_commerce_shipment_tracking"/);
  assert.doesNotMatch(ownerRoute, /auth\.admin[\s\S]*\.from\("shipping_requests"\)/);
  assert.match(hiddenTestRoute, /test_member_shipping_retired/);
  assert.match(hiddenTestRoute, /410/);
});

test("customer and operator UIs use complete-order and versioned shipment commands", async () => {
  const [account, operator] = await Promise.all([
    source("src/components/features/account/AccountDashboard.tsx"),
    source("src/components/admin/operator/OperatorShippingConsole.tsx"),
  ]);

  assert.match(account, /orderId:\s*selectedOrderId/);
  assert.match(account, /order\.status !== "paid"/);
  assert.match(account, /items\.every\(\(item\) => item\.payment_status === "paid"\)/);
  assert.match(account, /shipment\.payment/);
  assert.doesNotMatch(account, /productIds:\s*selectedIds|prepareShippingFee/);

  assert.match(operator, /shipmentId:\s*shipment\.shipment_id/);
  assert.match(operator, /expectedVersion:\s*shipment\.version/);
  assert.match(operator, /idempotencyKey/);
  assert.match(operator, /action === "pack"/);
  assert.match(operator, /action === "ship"/);
  assert.match(operator, /readiness_status === "ready_to_pack"/);
  assert.match(operator, /readiness_status === "ready_to_ship"/);
  assert.doesNotMatch(operator, /requestId, courier|product_ids/);
});

test("retired browser repositories no longer expose legacy shipping mutations", async () => {
  const [operations, memberAccount] = await Promise.all([
    source("src/lib/supabase/operations.ts"),
    source("src/lib/supabase/memberAccount.ts"),
  ]);
  const retiredNames = [
    "request_product_shipping",
    "get_shipping_work",
    "get_pending_shipping_work",
    "upsert_shipping_tracking_batch",
    "mark_shipping_request_shipped",
  ];
  for (const name of retiredNames) {
    assert.doesNotMatch(operations, new RegExp(name));
    assert.doesNotMatch(memberAccount, new RegExp(name));
  }
});

test("generated database types expose canonical shipment tables and commands", async () => {
  const types = await source("src/lib/supabase/database.types.ts");
  for (const contract of [
    "commerce_shipments:",
    "commerce_shipment_orders:",
    "commerce_shipment_items:",
    "commerce_shipment_events:",
    "commerce_shipment_reconciliation_cases:",
    "request_commerce_order_shipment:",
    "pack_commerce_shipment:",
    "ship_commerce_shipment:",
    "correct_commerce_shipment_tracking:",
    "get_commerce_shipment_queue:",
  ]) {
    assert.match(types, new RegExp(contract));
  }
  assert.match(types, /p_shipping_fee_amount: number \| null/);
  assert.match(types, /p_bank_name_snapshot: string \| null/);
  assert.match(types, /p_account_number_snapshot: string \| null/);
});
