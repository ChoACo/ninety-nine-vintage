import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../../supabase/migrations/20260805030000_use_store_membership_for_self_store_security.sql",
  import.meta.url,
);

const source = () => readFile(migrationPath, "utf8");

test("self-store security uses active operator memberships", async () => {
  const migration = await source();

  assert.match(
    migration,
    /function\s+app_private\.is_active_store_operator\s*\([\s\S]{0,800}membership_role\s*=\s*'operator'[\s\S]{0,120}status\s*=\s*'active'/i,
  );
  assert.match(
    migration,
    /function\s+public\.can_purchase_product[\s\S]{0,1800}is_active_store_operator\(products\.store_id,\s*auth\.uid\(\)\)/i,
  );
  assert.match(
    migration,
    /function\s+app_private\.reject_own_store_bid[\s\S]{0,900}is_active_store_operator[\s\S]{0,180}new\.bidder_id/i,
  );
  assert.match(
    migration,
    /function\s+app_private\.reject_own_store_purchase[\s\S]{0,1300}is_active_store_operator\(v_store,\s*v_buyer\)/i,
  );
});

test("stage 2 security functions do not use the representative operator column", async () => {
  const migration = await source();

  assert.doesNotMatch(
    migration,
    /function\s+(?:public\.can_purchase_product|app_private\.reject_own_store_bid|app_private\.reject_own_store_purchase)[\s\S]{0,1800}stores\.operator_id/i,
  );
});
