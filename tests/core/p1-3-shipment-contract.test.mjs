import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);

test("P1-3 protects inventory shipment mutations with a database permission gate", async () => {
  const migration = await readFile(
    new URL("supabase/migrations/20260805010000_enforce_inventory_shipment_mutation_gate.sql", rootUrl),
    "utf8",
  );

  assert.match(migration, /create or replace function app_private\.assert_inventory_shipment_mutation_gate/i);
  assert.match(migration, /new\.status in \('packed', 'shipped'\)/i);
  assert.match(migration, /old\.tracking_number is distinct from new\.tracking_number/i);
  assert.match(migration, /has_business_permission\(new\.business_id, 'create_shipments'\)/i);
  assert.match(migration, /inventory_shipments_mutation_gate/i);
});

test("P1-3 operator corrections carry an explicit reason into the shipment command", async () => {
  const route = await readFile(
    new URL("src/app/api/admin/operator/shipping/route.ts", rootUrl),
    "utf8",
  );
  const consoleSource = await readFile(
    new URL("src/components/admin/operator/OperatorShippingConsole.tsx", rootUrl),
    "utf8",
  );

  assert.match(route, /p_note: note/);
  assert.match(route, /tracking_update.*tracking_delete.*!note/s);
  assert.match(consoleSource, /송장 정정 사유/);
  assert.match(consoleSource, /note: form\.note\.trim\(\) \|\| null/);
  assert.match(consoleSource, /발송 완료 · 송장 1개/);
});

test("P1-3 retires every commerce_shipments writer and freezes legacy history", async () => {
  const migration = await readFile(
    new URL("supabase/migrations/20260808000000_retire_commerce_shipment_writes.sql", rootUrl),
    "utf8",
  );

  for (const signature of [
    "public\\.request_commerce_order_shipment\\(\\s*uuid, uuid, uuid, text, bigint, text, text, uuid\\s*\\)",
    "public\\.pack_commerce_shipment\\(\\s*uuid, bigint, uuid, text\\s*\\)",
    "public\\.ship_commerce_shipment\\(\\s*uuid, bigint, text, text, uuid, text\\s*\\)",
    "public\\.correct_commerce_shipment_tracking\\(\\s*uuid, bigint, text, text, text, uuid\\s*\\)",
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on function ${signature}[\\s\\S]*from public, anon, authenticated, service_role`),
    );
  }

  assert.match(migration, /guard_shipping_requests_retired/);
  assert.match(migration, /before insert or delete on public\.shipping_requests/);
  assert.match(migration, /guard_commerce_shipments_immutable/);
  assert.match(migration, /before insert or update or delete on public\.commerce_shipments/);
  assert.match(migration, /before insert or update or delete on public\.commerce_shipment_items/);
  assert.match(migration, /before insert or update or delete on public\.commerce_shipment_events/);
  assert.match(migration, /get_commerce_shipment_compat/);
  assert.match(migration, /'sourceKind'/);
  assert.match(migration, /legacy_commerce_shipment_id/);
});

test("P1-3 blocks the legacy orderId and owner tracking paths in the API", async () => {
  const [requestsRoute, ownerTrackingRoute] = await Promise.all([
    readFile(new URL("src/app/api/shipping/requests/route.ts", rootUrl), "utf8"),
    readFile(new URL("src/app/api/admin/owner/shipping/[id]/route.ts", rootUrl), "utf8"),
  ]);

  assert.match(requestsRoute, /"order_shipping_retired"/);
  assert.match(requestsRoute, /410/);
  assert.doesNotMatch(requestsRoute, /"request_commerce_order_shipment"/);
  assert.doesNotMatch(requestsRoute, /p_order_id:\s*body\.orderId/);

  assert.match(ownerTrackingRoute, /"legacy_shipment_retired"/);
  assert.match(ownerTrackingRoute, /410/);
  assert.doesNotMatch(ownerTrackingRoute, /correct_commerce_shipment_tracking/);
});
