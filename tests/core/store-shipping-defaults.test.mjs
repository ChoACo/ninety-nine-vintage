import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/20260822135937_backfill_store_shipping_fee_defaults.sql",
  import.meta.url,
);

test("every existing and future store has a checkout-safe shipping fee", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /left join public\.inventory_fulfillment_rollout_settings/);
  assert.match(sql, /coalesce\([\s\S]*settings\.shipping_fee_amount,[\s\S]*3500/);
  assert.match(sql, /greatest\(/);
  assert.match(sql, /regular_shipping_fee set default 3500/);
  assert.match(sql, /remote_area_shipping_fee set default 3500/);
  assert.match(sql, /^begin;[\s\S]*commit;\s*$/m);
});
