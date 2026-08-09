import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("direct-store checkout retires the legacy center-dependent triggers", async () => {
  const [cutover, inventoryV2] = await Promise.all([
    source("supabase/migrations/20260809103227_retire_legacy_central_checkout_triggers.sql"),
    source("supabase/migrations/20260722084550_add_unified_inventory_fulfillment_v2.sql"),
  ]);

  assert.match(
    cutover,
    /drop trigger if exists commerce_order_items_initialize_fulfillment\s+on public\.commerce_order_items/i,
  );
  assert.match(
    cutover,
    /drop trigger if exists commerce_order_items_sync_payment_fulfillment\s+on public\.commerce_order_items/i,
  );
  assert.doesNotMatch(cutover, /drop (?:function|table)/i);

  assert.match(
    inventoryV2,
    /create trigger commerce_order_items_project_inventory[\s\S]{0,240}app_private\.project_inventory_entitlement/i,
  );
});
