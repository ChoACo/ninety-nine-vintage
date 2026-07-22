import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const migrationUrls = [
  "supabase/migrations/20260722030000_add_central_fulfillment_foundation.sql",
  "supabase/migrations/20260722040000_add_store_memberships_permissions.sql",
  "supabase/migrations/20260722050000_activate_central_fulfillment_intake.sql",
].map((path) => new URL(path, rootUrl));
const runnerUrl = new URL(
  "scripts/verify-local-central-fulfillment-intake-postgres.mjs",
  rootUrl,
);
const bootstrapUrl = new URL(
  "tests/sql/central-fulfillment-intake/00-bootstrap.sql",
  rootUrl,
);
const contractUrl = new URL(
  "tests/sql/central-fulfillment-intake/10-contract.sql",
  rootUrl,
);
const concurrencyUrl = new URL(
  "tests/sql/central-fulfillment-intake/20-concurrency.sql",
  rootUrl,
);

async function sources() {
  const [
    foundation,
    memberships,
    intake,
    runner,
    bootstrap,
    contract,
    concurrency,
  ] =
    await Promise.all([
      ...migrationUrls.map((url) => readFile(url, "utf8")),
      readFile(runnerUrl, "utf8"),
      readFile(bootstrapUrl, "utf8"),
      readFile(contractUrl, "utf8"),
      readFile(concurrencyUrl, "utf8"),
    ]);
  return {
    foundation,
    memberships,
    intake,
    runner,
    bootstrap,
    contract,
    concurrency,
  };
}

function expectMatch(source, pattern, message) {
  assert.match(source, pattern, message);
}

test("intake runner applies foundation, membership, and activation in order", async () => {
  const { runner, bootstrap } = await sources();
  const foundationIndex = runner.indexOf("20260722030000");
  const membershipIndex = runner.indexOf("20260722040000");
  const intakeIndex = runner.indexOf("20260722050000");

  assert.ok(foundationIndex >= 0, "foundation migration is missing from runner");
  assert.ok(
    membershipIndex > foundationIndex,
    "membership migration must run after foundation",
  );
  assert.ok(
    intakeIndex > membershipIndex,
    "intake activation must run after membership permissions",
  );
  expectMatch(
    runner,
    /majorVersion\s*===\s*17\s*\|\|\s*majorVersion\s*===\s*18/u,
    "runner must use a supported PostgreSQL 17 or 18 cluster",
  );
  expectMatch(
    bootstrap,
    /create\s+extension\s+if\s+not\s+exists\s+pgcrypto\s+with\s+schema\s+extensions/i,
    "the production-compatible pgcrypto schema must be represented",
  );
});

test("activation is atomic and installs statement projection triggers", async () => {
  const { intake } = await sources();
  const trimmed = intake.trim();

  assert.match(trimmed, /^begin;/i);
  assert.match(trimmed, /commit;$/i);
  assert.equal(trimmed.match(/^begin;$/gim)?.length, 1);
  assert.equal(trimmed.match(/^commit;$/gim)?.length, 1);
  expectMatch(
    intake,
    /extensions\.digest\s*\(/i,
    "command fingerprints must use pgcrypto from the extensions schema",
  );
  expectMatch(
    intake,
    /create\s+trigger\s+commerce_order_items_initialize_fulfillment[\s\S]{0,220}after\s+insert\s+on\s+public\.commerce_order_items[\s\S]{0,180}referencing\s+new\s+table/i,
    "new items must initialize through one statement trigger",
  );
  expectMatch(
    intake,
    /create\s+trigger\s+commerce_order_items_sync_payment_fulfillment[\s\S]{0,220}after\s+update\s+on\s+public\.commerce_order_items[\s\S]{0,180}referencing\s+old\s+table[\s\S]{0,80}new\s+table/i,
    "payment changes must synchronize through transition tables",
  );
  expectMatch(
    intake,
    /for\s+v_work_id\s+in[\s\S]{0,500}order\s+by[\s\S]{0,400}for\s+update/i,
    "affected works must be relocked deterministically before refresh",
  );
});

test("payment synchronization defines explicit allowed transitions and fail-closed reversal", async () => {
  const { intake, contract } = await sources();

  for (const transition of [
    /old_items\.payment_status\s*=\s*'awaiting_payment'[\s\S]{0,120}new_items\.payment_status\s*=\s*'paid'/i,
    /old_items\.payment_status\s*=\s*'paid'[\s\S]{0,120}new_items\.payment_status\s*=\s*'awaiting_payment'/i,
    /old_items\.payment_status\s+in\s*\(\s*'awaiting_payment'\s*,\s*'paid'\s*\)[\s\S]{0,120}new_items\.payment_status\s*=\s*'cancelled'/i,
  ]) {
    assert.match(intake, transition);
  }
  expectMatch(
    intake,
    /raise\s+exception\s+using[\s\S]{0,100}errcode\s*=\s*'55000'[\s\S]{0,220}(?:payment|입금|결제)/i,
    "unsupported or physically unsafe payment changes must fail closed",
  );
  for (const phrase of [
    "awaiting-to-paid",
    "paid-to-awaiting",
    "cancelled-to-paid",
    "payment reversal must fail after store work reaches ready-for-transfer",
  ]) {
    assert.ok(contract.includes(phrase), `missing PostgreSQL case: ${phrase}`);
  }
});

test("owner and staff RPCs enforce permission, CAS, and idempotency boundaries", async () => {
  const { memberships, intake, contract } = await sources();

  expectMatch(
    intake,
    /create\s+or\s+replace\s+function\s+public\.configure_fulfillment_center[\s\S]{0,1400}not\s+public\.is_owner\(\)[\s\S]{0,120}v_actor_role\s*<>\s*'owner'/i,
    "center configuration must require both owner checks",
  );
  expectMatch(
    intake,
    /where\s+centers\.id\s*=\s*p_center_id[\s\S]{0,80}for\s+update[\s\S]{0,240}v_center\.version\s*<>\s*p_expected_version/i,
    "center configuration must compare a locked version",
  );
  expectMatch(
    intake,
    /has_store_permission\s*\(\s*v_work\.store_id\s*,\s*'prepare_orders'\s*\)/i,
    "store commands must use explicit store permission",
  );
  expectMatch(
    intake,
    /has_business_permission\s*\(\s*v_work\.business_id\s*,\s*'receive_at_center'\s*\)/i,
    "center commands must use explicit business permission",
  );
  expectMatch(
    memberships,
    /receive_at_center\s+boolean\s+not\s+null\s+default\s+false/i,
    "central permission must fail closed in the membership schema",
  );
  for (const phrase of [
    "exact center configuration replay",
    "stale center version",
    "Store A operator must not advance Store B work",
    "exact center item command replay",
  ]) {
    assert.ok(contract.includes(phrase), `missing PostgreSQL case: ${phrase}`);
  }
});

test("central actions and both queues encode the physical workflow", async () => {
  const { intake, contract } = await sources();

  for (const token of [
    "'partially_received'",
    "'received_at_center'",
    "'stored_at_center'",
    "'issue_reported'",
    "'issue_resolved'",
    "create or replace function public.get_store_fulfillment_queue",
    "create or replace function public.get_center_fulfillment_queue",
  ]) {
    assert.ok(intake.toLowerCase().includes(token), `missing intake token: ${token}`);
  }
  expectMatch(
    intake,
    /get_store_fulfillment_queue[\s\S]{0,8000}where\s+public\.has_store_permission\s*\(\s*works\.store_id\s*,\s*'prepare_orders'\s*\)/i,
    "store queue must preserve store scope",
  );
  expectMatch(
    intake,
    /get_center_fulfillment_queue[\s\S]{0,8000}public\.has_business_permission\s*\(\s*works\.business_id\s*,\s*'receive_at_center'/i,
    "center queue must use business-level intake scope",
  );
  for (const phrase of [
    "partial receipt",
    "reporting an issue",
    "resolving the issue",
    "concrete center storage location",
    "central queue must retain both received works",
  ]) {
    assert.ok(contract.includes(phrase), `missing PostgreSQL case: ${phrase}`);
  }
});

test("client tables and audit histories reject ambient or privileged bypass", async () => {
  const { foundation, memberships, intake, contract } = await sources();

  for (const source of [foundation, memberships, intake]) {
    expectMatch(
      source,
      /before\s+update\s+or\s+delete\s+or\s+truncate[\s\S]{0,180}for\s+each\s+statement/i,
      "every migration-owned audit log must have a statement append-only guard",
    );
  }
  expectMatch(
    intake,
    /revoke\s+all\s+privileges\s+on\s+table[\s\S]{0,300}public\.fulfillment_command_receipts[\s\S]{0,180}from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i,
    "command receipt DML must be revoked from every client role",
  );
  expectMatch(
    intake,
    /revoke\s+all\s+on\s+function\s+public\.record_center_item_action[\s\S]{0,180}service_role[\s\S]{0,180}grant\s+execute[\s\S]{0,180}to\s+authenticated/i,
    "mutation RPC execution must be authenticated-only",
  );
  for (const phrase of [
    "authenticated users must not mutate fulfillment projections directly",
    "service_role must not execute fulfillment mutation RPCs",
    "service_role must not read fulfillment command receipts",
  ]) {
    assert.ok(contract.includes(phrase), `missing PostgreSQL case: ${phrase}`);
  }
  expectMatch(
    contract,
    /foreach\s+v_table\s+in\s+array[\s\S]{0,500}fulfillment_events[\s\S]{0,500}foreach\s+v_action\s+in\s+array\s+array\['update'\s*,\s*'delete'\s*,\s*'truncate'\]/i,
    "the PostgreSQL contract must exercise every append-only operation",
  );
});

test("runner holds a ready transition open against a concurrent payment reversal", async () => {
  const { runner, concurrency } = await sources();

  assert.ok(
    runner.indexOf("20-concurrency.sql") > runner.indexOf("10-contract.sql"),
    "the real two-session race must run after the serial contract",
  );
  expectMatch(
    concurrency,
    /dblink_exec\s*\(\s*'ready_a'\s*,\s*'begin'\s*\)[\s\S]{0,1800}advance_store_fulfillment_work[\s\S]{0,1200}dblink_send_query\s*\(\s*'reversal_b'/i,
    "session A must hold the ready transition open before session B reverses payment",
  );
  expectMatch(
    concurrency,
    /wait_for_intake_lock_wait[\s\S]{0,180}fulfillment_intake_reversal_b[\s\S]{0,180}dblink_exec\s*\(\s*'ready_a'\s*,\s*'commit'/i,
    "the harness must observe session B waiting before session A commits",
  );
  expectMatch(
    concurrency,
    /payload\s*->>\s*'sqlstate'\s*=\s*'55000'[\s\S]{0,900}payment_status\s*=\s*'paid'[\s\S]{0,700}current_stage\s*=\s*'ready_for_transfer'/i,
    "the loser must fail 55000 and preserve paid/ready state",
  );
});
