import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../../supabase/migrations/20260822001910_allow_all_roles_to_purchase_store_products.sql",
  import.meta.url,
);

test("all commerce-eligible roles may buy products from stores they manage", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(
    migration,
    /function\s+public\.can_purchase_product[\s\S]{0,700}auth\.uid\(\)\s+is\s+not\s+null[\s\S]{0,200}public\.is_member\(\)/i,
  );
  assert.doesNotMatch(
    migration,
    /function\s+public\.can_purchase_product[\s\S]{0,900}is_active_store_operator/i,
  );
  assert.match(migration, /drop trigger if exists auction_bids_reject_own_store/i);
  assert.match(migration, /drop trigger if exists cart_items_reject_own_store/i);
  assert.match(migration, /drop trigger if exists commerce_order_items_reject_own_store/i);
  assert.match(
    migration,
    /grant execute on function public\.can_purchase_product\(uuid\) to authenticated/i,
  );
});
