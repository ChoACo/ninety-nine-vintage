import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("runtime database repair removes every reproduced db-lint failure", async () => {
  const repair = await source(
    "supabase/migrations/20260821111354_repair_runtime_database_contracts.sql",
  );

  assert.match(repair, /on conflict on constraint cart_items_pkey do nothing/i);
  assert.doesNotMatch(
    repair.match(/auto_direct_purchase_shipments[\s\S]*?(?=revoke all on function app_private\.auto_direct)/i)?.[0] ?? "",
    /min\s*\(\s*inventory\.id\s*\)/i,
  );
  assert.match(
    repair,
    /create or replace function public\.create_commerce_manual_transfer_checkout\([\s\S]*?p_shipping_region text[\s\S]*?returns jsonb/i,
  );
  assert.match(repair, /replace\(v_definition, 'blocked_reason', 'block_reason'\)/i);
  assert.match(repair, /replace\([\s\S]*?'v_product\.business_id'/i);
  assert.match(repair, /alter table public\.multi_provider_records enable row level security/i);
});

test("clean database ordering bootstraps the canary principal before its first policy", async () => {
  const migration = await source(
    "supabase/migrations/20260811113426_scope_membership_reads_to_canary_principal.sql",
  );
  const definition = migration.indexOf(
    "create or replace function public.current_authorization_principal()",
  );
  const policy = migration.indexOf(
    'create policy "Owners and members read store memberships"',
  );

  assert.ok(definition >= 0 && policy > definition);
  assert.match(migration, /select auth\.uid\(\)/i);
});

test("shipment queue migration is readable and preserves masked scoped output", async () => {
  const migration = await source(
    "supabase/migrations/20260821130000_add_storage_expiry_to_shipment_queue.sql",
  );

  assert.ok(migration.split(/\r?\n/).length > 100);
  assert.match(migration, /'storageExpiresAt'/);
  assert.match(migration, /'storageDurationDays'/);
  assert.match(migration, /app_private\.can_access_inventory_shipment/i);
  assert.match(migration, /'recipientName', '작업 시 확인'/);
  assert.doesNotMatch(migration, /\?앸|\?좎|諛곗/);
});

test("operator revenue uses its one fixed assignment while owner access stays selected", async () => {
  const migration = await source(
    "supabase/migrations/20260821112925_fix_assigned_operator_revenue_scope.sql",
  );

  assert.match(migration, /if v_role = 'owner'[\s\S]*?require_active_operator_store_scope/i);
  assert.match(migration, /elsif v_role = 'operator'[\s\S]*?store_memberships/i);
  assert.match(migration, /having count\(distinct memberships\.store_id\) = 1/i);
  assert.match(migration, /memberships\.view_reports|has_store_permission\(v_store_id, 'view_reports'\)/i);
  assert.doesNotMatch(migration, /min\s*\(\s*memberships\.store_id\s*\)/i);
});
