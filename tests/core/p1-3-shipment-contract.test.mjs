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
