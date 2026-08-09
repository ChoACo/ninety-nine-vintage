import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const migration = () => readFile(new URL(
  "supabase/migrations/20260809154907_scope_inventory_shipment_access.sql",
  rootUrl,
), "utf8");

test("shipment access requires exact direct or active-group store permission", async () => {
  const sql = await migration();
  const helper = sql.match(/create or replace function app_private\.can_access_inventory_shipment[\s\S]*?\n\$\$;/i)?.[0] ?? "";

  assert.match(helper, /not exists\s*\([\s\S]*from active_stores target/i);
  assert.match(helper, /direct_membership\.status = 'active'/i);
  assert.match(helper, /fulfillment_group\.is_active/i);
  assert.match(helper, /when 'create_shipments' then actor_membership\.create_shipments/i);
  assert.doesNotMatch(helper, /is_owner|has_business_permission|can_view_shared_fulfillment/i);
});

test("shipment list is scoped and masks personal delivery data", async () => {
  const sql = await migration();
  const queue = sql.match(/create or replace function public\.get_inventory_shipment_queue[\s\S]*?\n\$\$;/i)?.[0] ?? "";

  assert.match(queue, /can_access_inventory_shipment\(candidate\.id, 'create_shipments', v_actor\)/i);
  assert.match(queue, /'recipientName', '작업 시 확인'/);
  assert.match(queue, /'phone', '\*\*\*-\*\*\*\*-\*\*\*\*'/);
  assert.match(queue, /'address', '작업 시 확인'/);
  assert.doesNotMatch(queue, /'addressSnapshot', shipments\.address_snapshot/i);
});

test("all shipment mutations share the same scoped trigger gate", async () => {
  const sql = await migration();
  const gate = sql.match(/create or replace function app_private\.assert_inventory_shipment_mutation_gate[\s\S]*?\n\$\$;/i)?.[0] ?? "";

  assert.match(gate, /can_access_inventory_shipment\(new\.id, 'create_shipments', auth\.uid\(\)\)/i);
  assert.doesNotMatch(gate, /is_owner|has_business_permission|has_center_permission/i);
  assert.match(sql, /before update on public\.inventory_shipments[\s\S]*assert_inventory_shipment_mutation_gate/i);
});
