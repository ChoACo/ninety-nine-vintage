import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260822155001_add_one_step_inventory_dispatch.sql", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../../src/app/api/admin/operator/shipping/route.ts", import.meta.url),
  "utf8",
);
const consoleUi = readFileSync(
  new URL("../../src/components/admin/operator/OperatorShippingConsole.tsx", import.meta.url),
  "utf8",
);

test("one-step dispatch is atomic and preserves fulfillment safeguards", () => {
  assert.match(migration, /complete_inventory_shipment_with_tracking/);
  assert.match(migration, /for update of fulfillments, shipment_items/);
  assert.match(migration, /ownership_status <> 'active'/);
  assert.match(migration, /fulfillments\.is_blocked/);
  assert.match(migration, /exception_cases\.status = 'open'/);
  assert.match(migration, /set current_stage = 'shipped'/);
  assert.match(migration, /set line_status = 'shipped'/);
  assert.match(migration, /set status = 'outbound_complete'/);
  assert.match(migration, /set status = 'shipped'/);
  assert.match(migration, /shipping_fee_waiver_entitlements/);
  assert.doesNotMatch(migration, /미 출고된 상품이 존재합니다/);
});

test("operator route and UI use the one-step dispatch command", () => {
  assert.match(route, /action === "complete"/);
  assert.match(route, /"complete_inventory_shipment_with_tracking"/);
  assert.match(consoleUi, /원스톱 패킹 &amp; 송장 입력/);
  assert.match(consoleUi, /🚚 송장 등록 및 즉시 출고 완료/);
  assert.match(consoleUi, /CJ대한통운/);
  assert.match(consoleUi, /기타 \/ 직접입력/);
  assert.doesNotMatch(consoleUi, />미 출고된 상품이 존재합니다</);
});
