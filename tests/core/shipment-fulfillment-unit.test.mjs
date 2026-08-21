import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);

test("active shipments are bound to one store or one active fulfillment group", async () => {
  const [migration, foundation] = await Promise.all([
    readFile(new URL("supabase/migrations/20260809170609_bind_shipments_to_fulfillment_units.sql", rootUrl), "utf8"),
    readFile(new URL("supabase/migrations/20260722084550_add_unified_inventory_fulfillment_v2.sql", rootUrl), "utf8"),
  ]);
  assert.match(migration, /add column unit_kind text/i);
  assert.match(migration, /add column fulfillment_group_id uuid/i);
  assert.match(migration, /add column processing_store_id uuid/i);
  assert.match(migration, /groups\.is_active/i);
  assert.match(migration, /shipping_charge_mode = 'per_group'/i);
  assert.match(migration, /연결되지 않은 매장 상품은 하나의 배송 요청으로 묶을 수 없습니다/);
  assert.match(migration, /deferrable initially deferred/i);
  assert.match(migration, /one_active_store_unit_idx/i);
  assert.match(migration, /one_active_group_unit_idx/i);
  assert.match(foundation, /v_sh\.status<>'ready_to_pack'/i);
  assert.match(foundation, /x\.line_status<>'ready'/i);
  assert.match(foundation, /f\.is_blocked/i);
  assert.match(foundation, /status='packed'.*tracking_number/is);
});

test("direct purchases keep separate active shipments for each order address", async () => {
  const migration = await readFile(
    new URL("supabase/migrations/20260821140242_allow_parallel_direct_purchase_shipments.sql", rootUrl),
    "utf8",
  );
  assert.match(migration, /drop index if exists public\.inventory_shipments_one_active_store_unit_idx/i);
  assert.match(migration, /create unique index inventory_shipments_one_active_store_unit_idx/i);
  assert.match(migration, /settlement_method <> 'purchase_included'/i);
});
