import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const migrationUrl = new URL(
  "supabase/migrations/20260722030000_add_central_fulfillment_foundation.sql",
  rootUrl,
);
const databaseTypesUrl = new URL(
  "src/lib/supabase/database.types.ts",
  rootUrl,
);

async function migrationSource() {
  try {
    return await readFile(migrationUrl, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      assert.fail("central fulfillment foundation migration is missing");
    }
    throw error;
  }
}

async function databaseTypesSource() {
  return readFile(databaseTypesUrl, "utf8");
}

function expectMatch(source, pattern, message) {
  assert.ok(pattern.test(source), message);
}

test("foundation migration is atomic, bounded, and seeds no invented address", async () => {
  const migration = (await migrationSource()).trim();

  assert.match(migration, /^begin;/i);
  assert.match(migration, /commit;$/i);
  assert.equal(migration.match(/^begin;$/gim)?.length, 1);
  assert.equal(migration.match(/^commit;$/gim)?.length, 1);
  expectMatch(
    migration,
    /set\s+local\s+lock_timeout\s*=\s*'5s'/i,
    "the production backfill must not wait indefinitely behind commerce writers",
  );
  expectMatch(
    migration,
    /lock\s+table[\s\S]*public\.commerce_order_items[\s\S]*public\.shipping_request_items[\s\S]*in\s+share\s+row\s+exclusive\s+mode/i,
    "the legacy facts used by classification must remain stable during backfill",
  );

  expectMatch(
    migration,
    /insert\s+into\s+public\.fulfillment_centers\s*\(\s*id\s*,\s*business_id\s*,\s*code\s*,\s*name\s*,\s*status\s*,\s*is_default\s*\)[\s\S]{0,500}'configuration_required'\s*,\s*true/i,
    "the default center must be unusable until its real address is configured",
  );
  assert.doesNotMatch(
    migration,
    /(?:insert\s+into|update)\s+public\.fulfillment_centers[\s\S]{0,300}(?:postal_code|address_line1|contact_phone)\s*=/i,
    "the foundation must not guess or overwrite a real center address",
  );
  expectMatch(
    migration,
    /fulfillment_centers_configuration_required_check[\s\S]{0,300}postal_code\s+is\s+null[\s\S]{0,200}contact_phone\s+is\s+null/i,
    "a configuration-required center must keep every address and contact field empty",
  );
  expectMatch(
    migration,
    /fulfillment_centers_active_details_check[\s\S]{0,400}postal_code\s*~\s*'\^\[0-9\]\{5\}\$'[\s\S]{0,300}address_line1\s*!~\s*'\[\[:cntrl:\]\]'/i,
    "an active center must have a normalized postal code and bounded control-free address",
  );
});

test("legacy backfill refuses to infer physical receipt from payment or storage time", async () => {
  const migration = await migrationSource();

  expectMatch(
    migration,
    /when\s+items\.payment_status\s*=\s*'cancelled'\s+then\s+'cancelled'[\s\S]{0,400}shipping_requests\.status\s*=\s*'shipped'[\s\S]{0,160}then\s+'legacy_terminal'[\s\S]{0,100}else\s+'reconciliation_required'/i,
    "only cancelled items and explicit shipped evidence may receive terminal legacy classifications",
  );
  expectMatch(
    migration,
    /insert\s+into\s+public\.order_item_fulfillments[\s\S]{0,1200}classified\.initial_stage\s*,\s*'unknown'/i,
    "every legacy physical location must remain unknown",
  );
  assert.doesNotMatch(
    migration,
    /storage_expires_at[\s\S]{0,160}then\s+'(?:center_received|center_stored)'/i,
    "storage expiry is not evidence of physical center receipt",
  );
  expectMatch(
    migration,
    /'legacy_imported'[\s\S]{0,260}'migration'[\s\S]{0,180}'foundation_backfill'[\s\S]{0,400}'observed_storage_expires_at'/i,
    "the migration must record observed legacy evidence without converting it into a physical claim",
  );
});

test("foundation installs composite ownership constraints and physical-state checks", async () => {
  const migration = await migrationSource();

  for (const pattern of [
    /foreign\s+key\s*\(\s*store_id\s*,\s*business_id\s*\)[\s\S]{0,120}references\s+public\.stores\s*\(\s*id\s*,\s*business_id\s*\)/i,
    /foreign\s+key\s*\(\s*fulfillment_center_id\s*,\s*business_id\s*\)[\s\S]{0,140}references\s+public\.fulfillment_centers\s*\(\s*id\s*,\s*business_id\s*\)/i,
    /foreign\s+key\s*\(\s*order_item_id\s*,\s*order_id\s*,\s*store_id\s*\)[\s\S]{0,160}references\s+public\.commerce_order_items\s*\(\s*id\s*,\s*order_id\s*,\s*store_id\s*\)/i,
    /foreign\s+key\s*\(\s*work_id\s*,\s*business_id\s*,\s*order_id\s*,\s*store_id\s*,\s*fulfillment_center_id\s*\)[\s\S]{0,260}references\s+public\.store_fulfillment_works/i,
  ]) {
    assert.match(migration, pattern);
  }
  expectMatch(
    migration,
    /create\s+unique\s+index\s+fulfillment_centers_one_default_per_business_idx[\s\S]{0,160}where\s+is_default/i,
    "each business may have only one default center",
  );
  expectMatch(
    migration,
    /order_item_fulfillments_block_details_check[\s\S]{0,260}is_blocked[\s\S]{0,180}block_reason\s+is\s+null/i,
    "blocked state and its reason must agree",
  );
  expectMatch(
    migration,
    /order_item_fulfillments_stage_location_check[\s\S]{0,1000}current_stage\s*=\s*'center_stored'[\s\S]{0,180}storage_location_code\s+is\s+not\s+null[\s\S]{0,400}'reconciliation_required'[\s\S]{0,160}location_kind\s*=\s*'unknown'/i,
    "stage, physical location, and storage slot must be one coherent tuple",
  );
});

test("foundation is read-only to clients and adds no automatic fulfillment writer", async () => {
  const migration = await migrationSource();
  const functions = [
    ...migration.matchAll(
      /create\s+or\s+replace\s+function\s+([a-z_]+\.[a-z_]+)/gi,
    ),
  ].map((match) => match[1].toLowerCase());
  const triggers = [
    ...migration.matchAll(/create\s+trigger\s+([a-z_]+)/gi),
  ].map((match) => match[1].toLowerCase());

  assert.deepEqual(functions, ["app_private.reject_fulfillment_event_mutation"]);
  assert.deepEqual(triggers, ["fulfillment_events_append_only"]);
  expectMatch(
    migration,
    /create\s+trigger\s+fulfillment_events_append_only\s+before\s+update\s+or\s+delete\s+or\s+truncate[\s\S]{0,180}for\s+each\s+statement/i,
    "UPDATE, DELETE, and TRUNCATE must all cross the append-only guard",
  );
  assert.doesNotMatch(
    migration,
    /create\s+trigger[\s\S]{0,140}on\s+public\.(?:commerce_orders|commerce_order_items|shipping_requests)/i,
    "new order items must not be initialized automatically in this foundation phase",
  );
  expectMatch(
    migration,
    /revoke\s+all\s+privileges\s+on\s+table[\s\S]{0,400}public\.fulfillment_events[\s\S]{0,100}from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i,
    "ambient table DML must be removed from every client role",
  );
  expectMatch(
    migration,
    /grant\s+select\s+on\s+table[\s\S]{0,400}public\.fulfillment_events[\s\S]{0,80}to\s+authenticated/i,
    "authenticated callers may only enter the owner-filtered read boundary",
  );
  assert.equal(
    migration.match(/create\s+policy\s+"Owners read /gi)?.length,
    5,
  );
});

test("generated database snapshot includes the activated fulfillment boundary", async () => {
  const types = await databaseTypesSource();

  for (const table of [
    "businesses",
    "fulfillment_centers",
    "store_fulfillment_works",
    "order_item_fulfillments",
    "fulfillment_events",
  ]) {
    expectMatch(
      types,
      new RegExp(`^      ${table}: \\{$`, "m"),
      `${table} must be present in the database type snapshot`,
    );
  }
  expectMatch(
    types,
    /commerce_order_items:\s*\{[\s\S]{0,260}Row:\s*\{[\s\S]{0,260}store_id:\s*string(?:\r?\n)/,
    "commerce order item rows must expose the new non-null store boundary",
  );
  expectMatch(
    types,
    /stores:\s*\{[\s\S]{0,220}Row:\s*\{[\s\S]{0,100}business_id:\s*string/,
    "stores must expose their business boundary",
  );
  expectMatch(
    types,
    /^      configure_fulfillment_center: \{$/m,
    "the current type snapshot must expose the guarded center configuration RPC",
  );
  expectMatch(
    types,
    /^      record_center_item_action: \{$/m,
    "the current type snapshot must expose the guarded item action RPC",
  );
});
