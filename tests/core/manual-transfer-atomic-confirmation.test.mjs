import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const migrationPath =
  "supabase/migrations/20260721140000_harden_manual_transfer_confirmation.sql";
const revokeMigrationPath =
  "supabase/migrations/20260721135000_disable_direct_manual_transfer_confirmation.sql";
const fenceMigrationPath =
  "supabase/migrations/20260721134000_fence_legacy_auction_settlement.sql";
const queueSnapshotMigrationPath =
  "supabase/migrations/20260722010000_shared_commerce_payment_queue_snapshot.sql";

async function source(path) {
  try {
    return await readFile(new URL(path, rootUrl), "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      assert.fail(`missing contract source: ${path}`);
    }
    throw error;
  }
}

function expectMatch(value, pattern, message) {
  assert.ok(pattern.test(value), message);
}

function section(value, startToken, endToken, label) {
  const start = value.indexOf(startToken);
  assert.notEqual(start, -1, `${label}: start token is missing`);
  const end = value.indexOf(endToken, start + startToken.length);
  assert.notEqual(end, -1, `${label}: end token is missing`);
  return value.slice(start, end);
}

test("manual-transfer rollout migrations commit atomically per file", async () => {
  const paths = [
    fenceMigrationPath,
    revokeMigrationPath,
    migrationPath,
    "supabase/migrations/20260721141000_atomic_manual_transfer_checkout.sql",
    "supabase/migrations/20260721142000_allow_fixed_checkout_during_auction_blackout.sql",
    "supabase/migrations/20260721143000_grant_service_role_server_table_access.sql",
    queueSnapshotMigrationPath,
  ];

  for (const path of paths) {
    const sql = (await source(path)).trim();
    assert.match(sql, /^begin;/i, `${path}: migration must begin an explicit transaction`);
    assert.match(sql, /commit;$/i, `${path}: migration must commit its explicit transaction`);
    assert.equal(
      sql.match(/^begin;$/gim)?.length,
      1,
      `${path}: migration must have exactly one top-level begin`,
    );
    assert.equal(
      sql.match(/^commit;$/gim)?.length,
      1,
      `${path}: migration must have exactly one top-level commit`,
    );
  }
});

function sqlFunction(value, functionName) {
  const header = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${functionName}\\s*\\(`,
    "i",
  );
  const start = value.search(header);
  assert.notEqual(start, -1, `${functionName}: function definition is missing`);

  const tail = value.slice(start);
  const delimiterMatch = /\bas\s+(\$[A-Za-z0-9_]*\$)/i.exec(tail);
  assert.ok(delimiterMatch, `${functionName}: dollar-quoted body is missing`);
  const delimiter = delimiterMatch[1];
  const bodyStart = start + delimiterMatch.index + delimiterMatch[0].length;
  const end = value.indexOf(`${delimiter};`, bodyStart);
  assert.notEqual(end, -1, `${functionName}: closing delimiter is missing`);
  return value.slice(start, end + delimiter.length + 1);
}

function assertOrdered(value, tokens, label) {
  let cursor = -1;
  for (const token of tokens) {
    const next = value.indexOf(token, cursor + 1);
    assert.notEqual(next, -1, `${label}: missing token ${token}`);
    assert.ok(next > cursor, `${label}: ${token} is out of order`);
    cursor = next;
  }
}

test("commerce confirmation is ledger-gated and not executable by authenticated callers", async () => {
  const [migration, revokeMigration] = await Promise.all([
    source(migrationPath),
    source(revokeMigrationPath),
  ]);
  const confirmation = sqlFunction(
    migration,
    "confirm_commerce_order_transfer",
  );

  expectMatch(
    confirmation,
    /from\s+public\.manual_transfer_payment_ledger/i,
    "confirmation must derive the paid amount from the append-only ledger",
  );
  expectMatch(
    confirmation,
    /coalesce\s*\(\s*sum\s*\(\s*case\s+when\s+entry_type\s*=\s*'receipt'\s+then\s+amount\s+else\s+-amount\s+end\s*\)\s*,\s*0\s*\)/i,
    "confirmation must net receipts against reversals",
  );
  expectMatch(
    confirmation,
    /commerce_order_transfer_id\s*=/i,
    "confirmation must sum only the locked commerce transfer",
  );
  expectMatch(
    confirmation,
    /if\s+v_[a-z_]*(?:received|ledger)[a-z_]*\s*<>\s*(?:v_[a-z_]*expected[a-z_]*|v_transfer\.expected_amount)[\s\S]{0,240}raise\s+exception/i,
    "confirmation must reject a ledger total that differs from the expected amount",
  );

  const revoke = migration.match(
    /revoke\s+all\s+on\s+function\s+public\.confirm_commerce_order_transfer\s*\(\s*uuid\s*\)\s+from\s+([^;]+);/i,
  );
  assert.ok(revoke, "confirmation execute privileges must be explicitly revoked");
  for (const role of ["public", "anon", "authenticated", "service_role"]) {
    assert.match(revoke[1], new RegExp(`\\b${role}\\b`, "i"));
    assert.match(
      revokeMigration,
      new RegExp(
        `revoke\\s+all\\s+on\\s+function\\s+public\\.confirm_commerce_order_transfer\\s*\\(\\s*uuid\\s*\\)\\s+from[\\s\\S]{0,120}\\b${role}\\b`,
        "i",
      ),
      `phase-one revoke must remove ${role} commerce confirmation access`,
    );
  }
  assert.doesNotMatch(
    migration,
    /grant\s+execute\s+on\s+function\s+public\.confirm_commerce_order_transfer\s*\(\s*uuid\s*\)\s+to\s+authenticated/i,
    "authenticated callers must not regain direct commerce confirmation",
  );
});

test("the receipt-contract migration refuses to overlap active settlement writers", async () => {
  const migration = await source(migrationPath);
  const lock = migration.match(/lock\s+table([\s\S]*?)in\s+exclusive\s+mode\s+nowait\s*;/i);
  assert.ok(lock, "the phase-two migration must fail fast instead of waiting behind active writers");
  for (const tableName of [
    "products",
    "auction_purchase_offers",
    "manual_transfer_orders",
    "commerce_orders",
    "commerce_order_items",
    "commerce_order_transfers",
    "shipping_fee_payments",
  ]) {
    assert.match(lock[1], new RegExp(`public\\.${tableName}\\b`, "i"));
  }
  expectMatch(
    migration,
    /lock\s+table\s+public\.manual_transfer_payment_ledger\s+in\s+access\s+exclusive\s+mode\s+nowait\s*;/i,
    "ledger DDL must acquire its final lock without an upgrade gap",
  );
});

test("phase one disables every legacy settlement mutation until phase two succeeds", async () => {
  const [fenceMigration, revokeMigration, migration] = await Promise.all([
    source(fenceMigrationPath),
    source(revokeMigrationPath),
    source(migrationPath),
  ]);
  const firstRevoke = revokeMigration.indexOf(
    "revoke all on function public.confirm_commerce_order_transfer",
  );
  const auditEnd = revokeMigration.lastIndexOf("$$;", firstRevoke);
  assert.ok(auditEnd > -1 && firstRevoke > auditEnd, "historical totals must pass before maintenance revokes commit");
  expectMatch(
    revokeMigration,
    /lock\s+table[\s\S]{0,600}in\s+exclusive\s+mode\s+nowait\s*;/i,
    "phase one must audit a write-quiescent settlement snapshot",
  );
  expectMatch(
    fenceMigration,
    /create\s+trigger\s+auction_transfer_requires_settled_ledger[\s\S]{0,240}enforce_manual_transfer_ledger_confirmation[\s\S]*cron\.alter_job\s*\([\s\S]{0,120}active\s*=>\s*false/i,
    "phase zero must install the auction ledger fence before disabling the scheduler",
  );
  expectMatch(
    fenceMigration,
    /create\s+table\s+app_private\.manual_transfer_cron_rollout_state\s*\([\s\S]*job_id\s+bigint\s+not\s+null[\s\S]*job_name\s+text\s+not\s+null[\s\S]*original_schedule\s+text\s+not\s+null[\s\S]*original_command\s+text\s+not\s+null[\s\S]*original_database\s+text\s+not\s+null[\s\S]*original_username\s+text\s+not\s+null[\s\S]*original_active\s+boolean\s+not\s+null[\s\S]*restored_at\s+timestamptz/i,
    "phase zero must persist every mutable cron field needed for an exact restore",
  );
  expectMatch(
    fenceMigration,
    /revoke\s+all\s+on\s+table\s+app_private\.manual_transfer_cron_rollout_state\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i,
    "the cron rollout snapshot must not be exposed through API roles",
  );

  const snapshotInsert = fenceMigration.indexOf(
    "insert into app_private.manual_transfer_cron_rollout_state",
  );
  const cronDisable = fenceMigration.indexOf("perform cron.alter_job(");
  const disableVerification = fenceMigration.indexOf(
    "jobs.active is false",
    cronDisable,
  );
  assert.ok(
    snapshotInsert > -1 &&
      cronDisable > snapshotInsert &&
      disableVerification > cronDisable,
    "phase zero must snapshot before disabling and verify the disabled row afterward",
  );
  for (const field of ["schedule", "command", "database", "username"]) {
    expectMatch(
      fenceMigration.slice(cronDisable),
      new RegExp(
        `jobs\\.${field}\\s+is\\s+not\\s+distinct\\s+from\\s+v_original_${field}`,
        "i",
      ),
      `phase zero must verify ${field} did not drift during deactivation`,
    );
  }

  for (const [label, phase] of [
    ["phase zero", fenceMigration],
    ["phase one", revokeMigration],
    ["phase two", migration],
  ]) {
    expectMatch(
      phase,
      /pg_catalog\.pg_advisory_xact_lock\s*\(\s*pg_catalog\.hashtextextended\s*\(\s*'ninety-nine:manual-transfer-cron-rollout'\s*,\s*0\s*\)\s*\)/i,
      `${label} must serialize cron rollout metadata changes`,
    );
    assert.doesNotMatch(
      phase,
      /lock\s+table\s+cron\.job/i,
      `${label} must not require extension-table privileges unavailable to Supabase migrations`,
    );
  }

  for (const [label, phase] of [
    ["phase one", revokeMigration],
    ["phase two", migration],
  ]) {
    expectMatch(
      phase,
      /from\s+app_private\.manual_transfer_cron_rollout_state[\s\S]{0,180}restored_at\s+is\s+null/i,
      `${label} must require one unrestored rollout snapshot`,
    );
    expectMatch(
      phase,
      /where\s+jobs\.jobname\s*=\s*v_snapshot_job_name/i,
      `${label} must resolve the exact snapshotted job name`,
    );
    expectMatch(
      phase,
      /v_job_id\s+is\s+distinct\s+from\s+v_snapshot_job_id/i,
      `${label} must reject replacement of the snapshotted job identity`,
    );
    for (const field of ["schedule", "command", "database", "username"]) {
      expectMatch(
        phase,
        new RegExp(
          `v_current_${field}\\s+is\\s+distinct\\s+from\\s+v_original_${field}`,
          "i",
        ),
        `${label} must reject ${field} drift`,
      );
    }
    expectMatch(
      phase,
      /v_current_active\s+is\s+distinct\s+from\s+false/i,
      `${label} must keep the cron inactive throughout maintenance`,
    );
  }
  expectMatch(
    revokeMigration,
    /from\s+cron\.job_run_details[\s\S]{0,160}jobid\s*=\s*v_job_id[\s\S]{0,120}end_time\s+is\s+null/i,
    "phase one must refuse starting, connecting, and running scheduler calls",
  );
  expectMatch(
    revokeMigration,
    /status\s+in\s*\(\s*'starting'\s*,\s*'connecting'\s*,\s*'sending'\s*,\s*'running'\s*\)/i,
    "scheduler drain must cover every live pg_cron run state",
  );
  expectMatch(
    revokeMigration,
    /current_setting\s*\(\s*'cron\.log_run'\s*,\s*true\s*\)[\s\S]{0,180}<>\s*'on'[\s\S]{0,180}raise\s+exception/i,
    "scheduler history must be enabled before it is used as drain evidence",
  );
  for (const tableName of [
    "commerce_order_transfers",
    "manual_transfer_orders",
    "shipping_fee_payments",
  ]) {
    assert.match(
      revokeMigration.slice(0, auditEnd),
      new RegExp(`from\\s+public\\.${tableName}`, "i"),
    );
  }
  for (const signature of [
    "record_manual_transfer_payment\\s*\\(\\s*text\\s*,\\s*uuid\\s*,\\s*bigint\\s*,\\s*text\\s*,\\s*text\\s*\\)",
    "reverse_manual_transfer_payment\\s*\\(\\s*uuid\\s*,\\s*text\\s*\\)",
    "record_shipping_fee_payment\\s*\\(\\s*uuid\\s*,\\s*bigint\\s*,\\s*text\\s*,\\s*text\\s*\\)",
    "reverse_shipping_fee_payment\\s*\\(\\s*uuid\\s*,\\s*text\\s*\\)",
  ]) {
    assert.match(
      revokeMigration,
      new RegExp(
        `revoke\\s+all\\s+on\\s+function\\s+public\\.${signature}\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*,\\s*service_role`,
        "i",
      ),
    );
  }

  const finalGrant = migration.lastIndexOf(
    "grant execute on function public.reverse_shipping_fee_payment",
  );
  const cronRestore = migration.lastIndexOf(
    "perform cron.alter_job(",
  );
  assert.ok(
    finalGrant > -1 && cronRestore > finalGrant,
    "phase two must restore automated settlement only after every new mutation contract succeeds",
  );
  expectMatch(
    migration.slice(cronRestore),
    /perform\s+cron\.alter_job\s*\(\s*v_job_id\s*,\s*active\s*=>\s*v_original_active\s*\)/i,
    "phase two must restore the snapshotted active flag, including an originally inactive job",
  );
  const cronRestoreEnd = migration.indexOf(");", cronRestore);
  assert.ok(cronRestoreEnd > cronRestore, "the final cron restore call must close");
  assert.doesNotMatch(
    migration.slice(cronRestore, cronRestoreEnd + 2),
    /(?:schedule|command|database|username)\s*=>/i,
    "restoration must not overwrite custom cron metadata",
  );
  const restoreVerification = migration.slice(cronRestoreEnd + 2);
  for (const [field, original] of [
    ["jobname", "v_snapshot_job_name"],
    ["schedule", "v_original_schedule"],
    ["command", "v_original_command"],
    ["database", "v_original_database"],
    ["username", "v_original_username"],
    ["active", "v_original_active"],
  ]) {
    expectMatch(
      restoreVerification,
      new RegExp(
        `jobs\\.${field}\\s+is\\s+not\\s+distinct\\s+from\\s+${original}`,
        "i",
      ),
      `phase two must verify restored ${field}`,
    );
  }
  expectMatch(
    restoreVerification,
    /update\s+app_private\.manual_transfer_cron_rollout_state[\s\S]{0,160}set\s+restored_at\s*=\s*clock_timestamp\s*\(\s*\)/i,
    "the snapshot must be marked restored only after exact verification",
  );
});

test("receipt RPCs persist an actor-scoped key and compare the locked ledger version", async () => {
  const migration = await source(migrationPath);
  const manualReceipt = sqlFunction(migration, "record_manual_transfer_payment");
  const shippingReceipt = sqlFunction(migration, "record_shipping_fee_payment");

  expectMatch(
    migration,
    /alter\s+table\s+public\.manual_transfer_payment_ledger[\s\S]{0,300}add\s+column(?:\s+if\s+not\s+exists)?\s+idempotency_key\s+text/i,
    "the receipt ledger must store the idempotency key",
  );
  expectMatch(
    migration,
    /create\s+unique\s+index[\s\S]{0,240}on\s+public\.manual_transfer_payment_ledger\s*\(\s*recorded_by\s*,\s*idempotency_key\s*\)[\s\S]{0,160}where\s+entry_type\s*=\s*'receipt'/i,
    "receipt keys must be unique per recording actor",
  );

  for (const [label, receiptFunction] of [
    ["commerce/auction receipt", manualReceipt],
    ["shipping receipt", shippingReceipt],
  ]) {
    expectMatch(
      receiptFunction,
      /p_idempotency_key\s+text/i,
      `${label}: p_idempotency_key must be a required RPC argument`,
    );
    expectMatch(
      receiptFunction,
      /idempotency_key/i,
      `${label}: the RPC must read or write the idempotency key`,
    );
    expectMatch(
      receiptFunction,
      /recorded_by/i,
      `${label}: replay lookup must remain scoped to the actor`,
    );
    expectMatch(
      receiptFunction,
      /p_expected_received_amount\s+bigint/i,
      `${label}: the caller must provide the ledger total it observed`,
    );
    expectMatch(
      receiptFunction,
      /p_expected_ledger_entry_count\s+integer/i,
      `${label}: the caller must provide the monotonic ledger version it observed`,
    );
    expectMatch(
      receiptFunction,
      /v_received\s+is\s+distinct\s+from\s+p_expected_received_amount[\s\S]{0,180}v_ledger_entry_count\s+is\s+distinct\s+from\s+p_expected_ledger_entry_count[\s\S]{0,240}PT409/i,
      `${label}: a stale or ABA cross-operator receipt must fail after the parent lock`,
    );
    expectMatch(
      receiptFunction,
      /23505/,
      `${label}: reusing a key for a different receipt must be a conflict`,
    );
    expectMatch(
      receiptFunction,
      /if\s+found\s+then[\s\S]*?count\s*\(\s*\*\s*\)::integer[\s\S]*?'ledger_entry_count'\s*,\s*v_ledger_entry_count[\s\S]*?'idempotent_replay'\s*,\s*true/i,
      `${label}: an idempotent replay must return the same ledger-version field as a new receipt`,
    );
  }
});

test("partial auction receipts suspend automatic expiry before cron is restored", async () => {
  const migration = await source(migrationPath);
  const manualReceipt = sqlFunction(migration, "record_manual_transfer_payment");
  const manualReverse = sqlFunction(migration, "reverse_manual_transfer_payment");
  const ledgerGuard = sqlFunction(
    migration,
    "enforce_manual_transfer_ledger_confirmation",
  );
  const cronRestore = migration.lastIndexOf("perform cron.alter_job(");
  const holdBackfill = migration.indexOf(
    "update public.manual_transfer_orders as orders",
  );

  assert.ok(holdBackfill > -1 && holdBackfill < cronRestore);
  expectMatch(
    migration,
    /add\s+column(?:\s+if\s+not\s+exists)?\s+payment_deadline_held_at\s+timestamptz[\s\S]{0,180}due_at_before_payment_hold\s+timestamptz[\s\S]{0,180}offer_due_at_before_payment_hold\s+timestamptz/i,
    "the hold must distinguish an original NULL deadline from no hold",
  );
  expectMatch(
    migration,
    /where\s+orders\.status\s*=\s*'awaiting_manual_transfer'[\s\S]{0,180}totals\.received_amount\s+between\s+0\s+and\s+orders\.expected_amount\s*-\s*1[\s\S]{0,180}offers\.status\s+not\s+in\s*\(\s*'payment_due'\s*,\s*'accepted'\s*\)/i,
    "deployment must stop on a zero-balance order stranded by a legacy linked-offer reversal",
  );
  assertOrdered(
    migration.slice(holdBackfill, cronRestore),
    [
      "due_at_before_payment_hold = orders.due_at",
      "offer_due_at_before_payment_hold = (",
      "due_at = null",
      "update public.auction_purchase_offers as offers",
      "set payment_due_at = null",
    ],
    "legacy partial deadline snapshot",
  );
  expectMatch(
    manualReceipt,
    /v_auction\.due_at\s+is\s+not\s+null[\s\S]{0,260}clock_timestamp\(\)\s*>=\s*v_auction\.due_at[\s\S]{0,600}입금 기한이 지나/i,
    "a first receipt after the deadline must be rejected",
  );
  assertOrdered(
    manualReceipt,
    [
      "update public.auction_purchase_offers",
      "set payment_due_at = null",
      "update public.manual_transfer_orders",
      "set payment_deadline_held_at = case",
      "due_at_before_payment_hold = case",
      "offer_due_at_before_payment_hold = case",
      "due_at = null",
    ],
    "new partial deadline hold",
  );
  expectMatch(
    manualReceipt,
    /when\s+v_auction\.payment_deadline_held_at\s+is\s+null\s+then\s+v_auction\.due_at[\s\S]{0,180}else\s+v_auction\.due_at_before_payment_hold/i,
    "later partial receipts must not overwrite the first exact deadline snapshot",
  );
  expectMatch(
    manualReverse,
    /when\s+v_received\s*=\s*0\s+and\s+payment_deadline_held_at\s+is\s+not\s+null\s+then\s+due_at_before_payment_hold[\s\S]{0,300}when\s+v_received\s*=\s*0\s+then\s+null/i,
    "a zero-balance non-offer reversal must restore the exact snapshot and clear the hold",
  );
  assert.doesNotMatch(
    manualReverse,
    /original_manual_payment_due_at/i,
    "a reversal must never synthesize a replacement deadline from mutable policy",
  );
  expectMatch(
    ledgerGuard,
    /v_received\s+between\s+1\s+and\s+new\.expected_amount\s*-\s*1[\s\S]{0,180}new\.payment_deadline_held_at\s+is\s+not\s+null[\s\S]{0,100}new\.due_at\s+is\s+null/i,
    "the parent trigger must reject partial money without an explicit deadline hold",
  );
});

test("operator balances are full-ledger aggregates and the commerce queue is shared", async () => {
  const [migration, queueMigration, operatorRoute, ownerRoute] = await Promise.all([
    source(migrationPath),
    source(queueSnapshotMigrationPath),
    source("src/app/api/admin/operator/orders/route.ts"),
    source("src/app/api/admin/owner/operations/route.ts"),
  ]);
  const balances = sqlFunction(
    migration,
    "get_manual_transfer_ledger_balances",
  );

  expectMatch(
    balances,
    /count\s*\(\s*ledger\.id\s*\)::bigint/i,
    "the CAS version must be aggregated in PostgreSQL",
  );
  expectMatch(
    balances,
    /when\s+ledger\.entry_type\s*=\s*'receipt'\s+then\s+ledger\.amount[\s\S]{0,140}when\s+ledger\.entry_type\s*=\s*'reversal'\s+then\s+-ledger\.amount/i,
    "the aggregate must use the signed ledger total",
  );
  const queueSnapshot = sqlFunction(
    queueMigration,
    "get_shared_commerce_payment_queue_page",
  );
  expectMatch(
    queueSnapshot,
    /count\s*\(\s*ledger\.id\s*\)::bigint/i,
    "the shared queue CAS version must be aggregated in its statement snapshot",
  );
  expectMatch(
    queueSnapshot,
    /when\s+ledger\.entry_type\s*=\s*'receipt'\s+then\s+ledger\.amount[\s\S]{0,140}when\s+ledger\.entry_type\s*=\s*'reversal'\s+then\s+-ledger\.amount/i,
    "the shared queue must use the signed full-ledger total",
  );
  assert.doesNotMatch(operatorRoute, /get_manual_transfer_ledger_balances/);
  assert.ok(
    (ownerRoute.match(/get_manual_transfer_ledger_balances/g) ?? []).length >= 3,
  );
  assert.doesNotMatch(
    operatorRoute,
    /\.eq\(\s*"operator_id"|\.in\(\s*"store_id"/,
    "the unified commerce payment queue must not be restricted to one store",
  );
  expectMatch(
    operatorRoute,
    /const\s+receivedAmount\s*=\s*value\.received_amount[\s\S]{0,100}const\s+ledgerEntryCount\s*=\s*value\.ledger_entry_count/,
    "the validated queue snapshot must drive the receipt CAS",
  );
  expectMatch(operatorRoute, /\breceivedAmount,[\s\S]{0,80}\bledgerEntryCount,/);
  assert.doesNotMatch(
    ownerRoute,
    /from\(\s*"manual_transfer_payment_ledger"\s*\)/,
    "the owner queue must not derive balances from a max_rows-limited history response",
  );
  expectMatch(
    operatorRoute,
    /auth\.user\.rpc\([\s\S]{0,100}"get_shared_commerce_payment_queue_page"/,
    "the API must use the authenticated shared snapshot RPC",
  );
  assert.doesNotMatch(
    operatorRoute,
    /\.from\(\s*"commerce_order_transfers"\s*\)/,
    "the API must not race separate active and completed table reads",
  );
});

test("shared payment evidence is a bounded projection and direct staff rows stay closed", async () => {
  const [migration, queueMigration, operatorRoute, ledgerRoute, operatorConsole] = await Promise.all([
    source(migrationPath),
    source(queueSnapshotMigrationPath),
    source("src/app/api/admin/operator/orders/route.ts"),
    source("src/app/api/admin/operator/transfers/[id]/ledger/route.ts"),
    source("src/components/admin/operator/OperatorOrdersConsole.tsx"),
  ]);
  const summaries = sqlFunction(
    migration,
    "get_shared_commerce_payment_order_summaries",
  );
  const directReadPolicies = section(
    migration,
    "-- Staff payment operations use the audited projections below.",
    "-- Balance/version reads are aggregated in PostgreSQL",
    "direct commerce read policies",
  );

  expectMatch(
    summaries,
    /auth\.uid\(\)\s+is\s+null\s+or\s+not\s+public\.is_staff\(\)/i,
    "only owner/operator database roles may read the shared projection",
  );
  expectMatch(
    summaries,
    /array_length\(p_order_ids,\s*1\)\s*>\s*500/i,
    "the projection input must remain below PostgREST's top-level row bound",
  );
  expectMatch(
    summaries,
    /count\s*\(\s*order_items\.id\s*\)::bigint[\s\S]{0,1200}jsonb_agg\s*\(/i,
    "each order must return an authoritative count and nested item summary in one row",
  );
  assert.doesNotMatch(
    directReadPolicies,
    /public\.is_staff\(\)/i,
    "staff must not retain a broader direct-table read path around the projection",
  );
  assert.doesNotMatch(
    operatorRoute,
    /\.from\(\s*"commerce_order_items"\s*\)/,
    "the API must not rebuild payment evidence from a max_rows-limited item query",
  );
  expectMatch(
    operatorRoute,
    /summary\.items\.length\s*!==\s*summary\.item_count/,
    "the API must fail closed when a projected order summary is incomplete",
  );
  expectMatch(
    queueMigration,
    /limit\s+401[\s\S]{0,1800}count\(\*\)\s*>\s*400\s+as\s+active_overflow/i,
    "an oversized active queue must fail closed instead of hiding payable transfers",
  );
  expectMatch(
    queueMigration,
    /jsonb_build_object\([\s\S]{0,700}'recorded_by',[\s\S]{0,120}'created_at'/i,
    "the audit projection must include its actor and timestamp",
  );
  assert.doesNotMatch(
    operatorRoute,
    /\.select\(\s*"\*"\s*\)/,
    "future transfer columns must not be exposed implicitly to every operator",
  );
  expectMatch(
    queueMigration,
    /selected_transfers\s+as\s+materialized[\s\S]{0,700}union\s+all[\s\S]{0,240}history_page/i,
    "active and completed lanes must be selected inside one statement snapshot",
  );
  expectMatch(
    operatorConsole,
    /historyHasMore[\s\S]*appendHistory[\s\S]*이전 완료·취소 이력 더 보기/,
    "the console must page older completed history instead of silently truncating it",
  );
  expectMatch(
    operatorConsole,
    /처리자\s+\{entry\.recorded_by\}[\s\S]{0,120}entry\.created_at/,
    "the visible audit history must show who acted and when",
  );

  for (const [label, route] of [
    ["shared queue", operatorRoute],
    ["ledger mutation", ledgerRoute],
  ]) {
    expectMatch(
      route,
      /auth\.roleCode\s*!==\s*"owner"\s*&&\s*auth\.roleCode\s*!==\s*"operator"[\s\S]{0,120}forbidden[\s\S]{0,40}403/,
      `${label} must explicitly exclude employees until confirm_payments exists`,
    );
  }
});

test("unified commerce receipts support the full multi-item order amount", async () => {
  const migration = await source(migrationPath);
  const manualReceipt = sqlFunction(migration, "record_manual_transfer_payment");

  expectMatch(
    migration,
    /manual_transfer_payment_ledger_amount_check[\s\S]{0,180}amount\s*>\s*0[\s\S]{0,160}transfer_kind\s*=\s*'commerce'\s+or\s+amount\s*<=\s*1000000000/i,
    "commerce receipts may exceed the legacy per-item ceiling while other receipt kinds remain bounded",
  );
  expectMatch(
    manualReceipt,
    /p_transfer_kind\s*=\s*'auction'\s+and\s+p_amount\s*>\s*1000000000/i,
    "the auction receipt ceiling must remain explicit after widening commerce receipts",
  );
  assert.doesNotMatch(
    manualReceipt,
    /p_amount\s*>\s*1000000000\s+then/i,
    "a unified commerce receipt must not be rejected solely for exceeding one product's ceiling",
  );
});

test("manual commerce mutations hold the runtime mode before payment parents", async () => {
  const migration = await source(migrationPath);
  const manualReceipt = sqlFunction(migration, "record_manual_transfer_payment");
  const manualReverse = sqlFunction(migration, "reverse_manual_transfer_payment");

  for (const [label, mutation] of [
    ["receipt", manualReceipt],
    ["reversal", manualReverse],
  ]) {
    const modeLock = mutation.search(
      /from\s+public\.payment_runtime_settings[\s\S]{0,100}for\s+update/i,
    );
    const manualMode = mutation.search(/active_mode\s*<>\s*'manual_transfer'/i);
    const parentLock = mutation.search(
      /from\s+public\.(?:commerce_orders|manual_transfer_orders)[\s\S]{0,180}for\s+update/i,
    );
    assert.ok(modeLock > -1, `${label} must lock the payment runtime row`);
    assert.ok(manualMode > modeLock, `${label} must require manual-transfer mode`);
    assert.ok(
      parentLock > manualMode,
      `${label} must establish the runtime mode before locking a payment parent`,
    );
  }
});

test("legacy auction payment reads match the store-scoped mutation boundary", async () => {
  const migration = await source(migrationPath);
  const pendingAuctionTransfers = sqlFunction(
    migration,
    "get_pending_manual_transfers",
  );
  const balances = sqlFunction(
    migration,
    "get_manual_transfer_ledger_balances",
  );
  const manualReceipt = sqlFunction(migration, "record_manual_transfer_payment");
  const manualReverse = sqlFunction(migration, "reverse_manual_transfer_payment");
  const replayBranch = section(
    manualReceipt,
    "if found then",
    "select settings.* into v_settings",
    "manual receipt replay branch",
  );

  expectMatch(
    pendingAuctionTransfers,
    /join\s+public\.stores\s+as\s+stores[\s\S]{0,120}stores\.id\s*=\s*products\.store_id/i,
    "the legacy projection must resolve the product's owning store",
  );
  expectMatch(
    pendingAuctionTransfers,
    /public\.is_owner\(\)[\s\S]{0,180}stores\.operator_id\s*=\s*v_actor/i,
    "Owner may read every auction payment but an operator may read only their store",
  );
  expectMatch(
    pendingAuctionTransfers,
    /stores\.operator_id\s*=\s*v_actor[\s\S]{0,260}owner_hidden_test_members/i,
    "hidden Owner test members must not leak through the operator projection",
  );
  expectMatch(
    balances,
    /stores\.operator_id\s*=\s*v_actor[\s\S]{0,260}owner_hidden_test_members[\s\S]{0,160}orders\.buyer_id/i,
    "an operator must not probe a hidden Owner test payment through the balance RPC",
  );
  expectMatch(
    manualReceipt,
    /stores\.operator_id\s*=\s*v_actor[\s\S]{0,300}owner_hidden_test_members[\s\S]{0,160}v_auction\.buyer_id/i,
    "an operator must not record money for a hidden Owner test member",
  );
  expectMatch(
    replayBranch,
    /stores\.operator_id\s*=\s*v_actor[\s\S]{0,300}owner_hidden_test_members[\s\S]{0,160}v_auction\.buyer_id/i,
    "an idempotent auction replay must recheck the actor's current store and hidden-member scope",
  );
  expectMatch(
    manualReverse,
    /stores\.operator_id\s*=\s*v_actor[\s\S]{0,300}owner_hidden_test_members[\s\S]{0,160}v_member_id/i,
    "an operator must not reverse money for a hidden Owner test member",
  );
  expectMatch(
    manualReceipt,
    /is_owner_hidden_test_member\s*\(\s*v_auction\.buyer_id\s*\)[\s\S]{0,160}set_config\s*\(\s*'app\.owner_hidden_test_actor'\s*,\s*v_actor::text\s*,\s*true\s*\)/i,
    "an authorized Owner receipt must set the hidden-test write marker before mutation",
  );
  expectMatch(
    manualReverse,
    /is_owner_hidden_test_member\s*\(\s*v_member_id\s*\)[\s\S]{0,160}set_config\s*\(\s*'app\.owner_hidden_test_actor'\s*,\s*v_actor::text\s*,\s*true\s*\)/i,
    "an authorized Owner reversal must set the hidden-test write marker before mutation",
  );
  assertOrdered(
    manualReceipt,
    [
      "where hidden_test_members.test_user_id = v_auction.buyer_id",
      "perform set_config('app.owner_hidden_test_actor', v_actor::text, true)",
      "insert into public.manual_transfer_payment_ledger",
    ],
    "hidden test Owner receipt marker before ledger mutation",
  );
  assertOrdered(
    manualReverse,
    [
      "where hidden_test_members.test_user_id = v_member_id",
      "if v_purchase_offer_id is not null then",
    ],
    "hidden test authorization before linked-offer state disclosure",
  );
  expectMatch(
    migration,
    /revoke\s+all\s+on\s+function\s+public\.get_pending_manual_transfers\s*\(\s*integer\s*,\s*integer\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i,
    "the replacement projection must reset every inherited API grant",
  );
});

test("auction and shipping confirmations share the ledger-only invariant", async () => {
  const migration = await source(migrationPath);
  const manualReceipt = sqlFunction(migration, "record_manual_transfer_payment");
  const ledgerGuard = sqlFunction(
    migration,
    "enforce_manual_transfer_ledger_confirmation",
  );

  expectMatch(
    migration,
    /revoke\s+all\s+on\s+function\s+public\.confirm_manual_transfer\s*\(\s*uuid\s*,\s*timestamptz\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i,
    "auction confirmation must not remain directly executable",
  );
  assert.doesNotMatch(
    migration,
    /grant\s+execute\s+on\s+function\s+public\.confirm_manual_transfer/i,
    "auction confirmation must remain internal-only",
  );
  for (const tableName of [
    "commerce_order_transfers",
    "manual_transfer_orders",
    "shipping_fee_payments",
  ]) {
    assert.match(
      ledgerGuard,
      new RegExp(`tg_table_name\\s*=\\s*'${tableName}'`, "i"),
      `${tableName} must be covered by the ledger confirmation guard`,
    );
  }
  const preflight = section(
    migration,
    "do $$",
    "create or replace function public.enforce_manual_transfer_ledger_confirmation",
    "legacy ledger preflight",
  );
  for (const tableName of [
    "commerce_order_transfers",
    "manual_transfer_orders",
    "shipping_fee_payments",
  ]) {
    assert.match(
      preflight,
      new RegExp(`from\\s+public\\.${tableName}`, "i"),
      `${tableName} historical totals must be checked before triggers are installed`,
    );
  }
  expectMatch(
    manualReceipt,
    /v_auction\.status\s*<>\s*'awaiting_manual_transfer'/i,
    "cancelled_unpaid auction orders must reject new receipts",
  );
  for (const status of [
    "awaiting_manual_transfer",
    "cancelled_unpaid",
    "awaiting_transfer",
    "partially_paid",
    "confirmed",
    "cancelled",
  ]) {
    assert.match(
      ledgerGuard,
      new RegExp(`new\\.status\\s*=\\s*'${status}'`, "i"),
      `${status} must have an explicit signed-ledger contract`,
    );
  }
});

test("non-idempotent overloads are removed and parent rows lock before ledger rows", async () => {
  const migration = await source(migrationPath);
  const manualReceipt = sqlFunction(migration, "record_manual_transfer_payment");
  const manualReverse = sqlFunction(migration, "reverse_manual_transfer_payment");
  const shippingReverse = sqlFunction(migration, "reverse_shipping_fee_payment");

  expectMatch(
    migration,
    /drop\s+function\s+public\.record_manual_transfer_payment\s*\(\s*text\s*,\s*uuid\s*,\s*bigint\s*,\s*text\s*,\s*text\s*\)/i,
    "the legacy manual receipt overload must be removed",
  );
  expectMatch(
    migration,
    /drop\s+function\s+public\.record_shipping_fee_payment\s*\(\s*uuid\s*,\s*bigint\s*,\s*text\s*,\s*text\s*\)/i,
    "the legacy shipping receipt overload must be removed",
  );
  expectMatch(
    manualReceipt,
    /p_depositor_name\s+text\s*,\s*p_expected_received_amount\s+bigint\s*,\s*p_expected_ledger_entry_count\s+integer\s*,\s*p_idempotency_key\s+text\s*,\s*p_memo\s+text\s+default/i,
    "the required ledger total, version, and key must precede the optional memo",
  );

  assertOrdered(
    manualReceipt,
    [
      "select transfers.order_id into v_order_id",
      "from public.commerce_orders as orders",
      "from public.commerce_order_transfers as transfers",
      "insert into public.manual_transfer_payment_ledger",
    ],
    "commerce receipt lock order",
  );
  assertOrdered(
    manualReceipt,
    [
      "perform 1 from public.products as products",
      "from public.auction_purchase_offers as offers",
      "select orders.* into v_auction",
    ],
    "auction receipt lock order",
  );
  assertOrdered(
    manualReverse,
    [
      "select orders.member_id into v_member_id",
      "join public.commerce_order_items as items on items.product_id = products.id",
      "from public.commerce_order_transfers as transfers",
      "from public.manual_transfer_payment_ledger as ledger",
    ],
    "commerce reversal lock order",
  );
  assertOrdered(
    shippingReverse,
    [
      "from public.shipping_fee_payments as payments",
      "from public.manual_transfer_payment_ledger as ledger",
    ],
    "shipping reversal lock order",
  );
});

test("reversals fail closed when downstream auction or shipping state also needs reconciliation", async () => {
  const migration = await source(migrationPath);
  const manualReverse = sqlFunction(migration, "reverse_manual_transfer_payment");
  const shippingReverse = sqlFunction(migration, "reverse_shipping_fee_payment");

  expectMatch(
    manualReverse,
    /if\s+v_purchase_offer_id\s+is\s+not\s+null[\s\S]{0,240}raise\s+exception/i,
    "purchase-offer settlements must not be reversed without reconciling the offer",
  );
  expectMatch(
    shippingReverse,
    /if\s+v_payment\.shipping_request_id\s+is\s+not\s+null[\s\S]{0,240}raise\s+exception/i,
    "shipping-request fees must not be reversed while the request remains actionable",
  );
});

test("a confirmed commerce reversal appends a member-facing correction notification", async () => {
  const migration = await source(migrationPath);
  const manualReverse = sqlFunction(migration, "reverse_manual_transfer_payment");

  expectMatch(
    manualReverse,
    /declare[\s\S]{0,500}v_member_id\s+uuid\s*;/i,
    "the reversal function must declare the member identifier used by its notification",
  );
  expectMatch(
    manualReverse,
    /select\s+orders\.member_id\s+into\s+v_member_id[\s\S]{0,180}for\s+update/i,
    "the reversal must read the affected member while holding the order lock",
  );
  expectMatch(
    manualReverse,
    /transfers\.expected_amount\s*,\s*transfers\.status\s*=\s*'confirmed'\s+into\s+v_expected\s*,\s*v_was_confirmed/i,
    "the reversal must remember whether the customer was previously told payment was confirmed",
  );
  expectMatch(
    manualReverse,
    /if\s+v_was_confirmed\s+then[\s\S]{0,520}insert\s+into\s+public\.notifications[\s\S]{0,520}'payment_reversed'[\s\S]{0,300}'\/account#orders'/i,
    "reopening a confirmed order must append a correction notification in the same transaction",
  );
});

test("the ledger API validates receipts and distinguishes rejected from unknown RPC outcomes", async () => {
  const route = await source(
    "src/app/api/admin/operator/transfers/[id]/ledger/route.ts",
  );
  const recordBranch = section(
    route,
    'if (body.action === "record")',
    'if (body.action === "reverse")',
    "record API branch",
  );

  assert.doesNotMatch(
    recordBranch,
    /body\.kind\s*===\s*"auction"\s*\?\s*"auction"\s*:\s*body\.kind\s*===\s*"shipping"\s*\?\s*"shipping"\s*:\s*"commerce"/,
    "unknown kinds must not silently fall back to commerce",
  );
  const comparisonValidation = ["auction", "commerce", "shipping"].every(
    (kind) => recordBranch.includes(`body.kind !== "${kind}"`),
  );
  const listValidation =
    /\[\s*["'](?:auction|commerce|shipping)["'][\s\S]{0,120}\.includes\(body\.kind/.test(
      recordBranch,
    );
  assert.ok(
    comparisonValidation || listValidation,
    "record API must explicitly reject every kind outside commerce, auction, and shipping",
  );
  expectMatch(
    recordBranch,
    /const\s+idempotencyKey\s*=\s*asIdempotencyKey\(body\.idempotencyKey\)/,
    "record API must require one validated key for every receipt kind",
  );
  assert.doesNotMatch(
    recordBranch,
    /kind\s*===\s*"shipping"\s*\?\s*""/,
    "shipping receipts must not bypass idempotency validation",
  );
  assert.equal(
    (recordBranch.match(/p_idempotency_key:\s*idempotencyKey/g) ?? []).length,
    2,
    "both manual-transfer and shipping receipt RPC calls must receive the key",
  );
  assert.equal(
    (recordBranch.match(/p_expected_received_amount:\s*expectedReceivedAmount/g) ?? []).length,
    2,
    "both receipt RPCs must receive the caller's observed ledger total",
  );
  assert.equal(
    (recordBranch.match(/p_expected_ledger_entry_count:\s*expectedLedgerEntryCount/g) ?? []).length,
    2,
    "both receipt RPCs must receive the caller's observed ledger version",
  );
  expectMatch(
    recordBranch,
    /const\s+\{\s*data\s*,\s*error\s*,\s*status\s*\}/,
    "the API must inspect the PostgREST transport status",
  );
  expectMatch(
    recordBranch,
    /status\s*>=\s*400\s*&&\s*status\s*<\s*500\s*\?\s*"rejected"\s*:\s*"unknown"/,
    "only a confirmed client or database rejection may be reported as definitive",
  );
  expectMatch(
    recordBranch,
    /outcome\s*===\s*"rejected"\s*\?\s*409\s*:\s*503/,
    "transport and upstream failures must be returned as retry-safe unknown outcomes",
  );
  expectMatch(
    route,
    /function\s+asManualTransferRecordResult[\s\S]{0,1200}typeof\s+result\.idempotent_replay\s*!==\s*"boolean"[\s\S]{0,300}ledger_entry_count/,
    "the API must validate the replay marker and ledger version before acknowledging a receipt",
  );
  expectMatch(
    recordBranch,
    /const\s+result\s*=\s*asManualTransferRecordResult\(data,\s*kind,\s*id\)[\s\S]{0,300}manual_transfer_record_result_unknown[\s\S]{0,180}result\.idempotent_replay\s*\?\s*200\s*:\s*201/,
    "malformed RPC JSON must remain an unknown outcome while replays return a distinct success status",
  );
  expectMatch(
    route,
    /\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-4\[0-9a-f\]\{3\}-\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}\$/,
    "the API must reserve legacy keys by accepting only canonical UUID v4 keys",
  );
});

test("generated database types include receipt keys and exact deadline holds", async () => {
  const databaseTypes = await source("src/lib/supabase/database.types.ts");
  const manualOrderTable = section(
    databaseTypes,
    "manual_transfer_orders:",
    "Relationships:",
    "manual transfer order type",
  );
  const ledgerTable = section(
    databaseTypes,
    "manual_transfer_payment_ledger:",
    "Relationships:",
    "manual transfer ledger type",
  );
  const manualReceipt = section(
    databaseTypes,
    "record_manual_transfer_payment:",
    "record_owner_operator_delegated_action:",
    "manual receipt RPC type",
  );
  const shippingReceipt = section(
    databaseTypes,
    "record_shipping_fee_payment:",
    "reopen_support_conversation:",
    "shipping receipt RPC type",
  );

  assert.ok(
    (ledgerTable.match(/idempotency_key\??:/g) ?? []).length >= 3,
    "ledger Row, Insert, and Update types must include idempotency_key",
  );
  for (const field of [
    "payment_deadline_held_at",
    "due_at_before_payment_hold",
    "offer_due_at_before_payment_hold",
  ]) {
    assert.ok(
      (manualOrderTable.match(new RegExp(`${field}\\??:`, "g")) ?? []).length >= 3,
      `manual transfer Row, Insert, and Update types must include ${field}`,
    );
  }
  expectMatch(
    manualReceipt,
    /p_idempotency_key:\s*string/,
    "record_manual_transfer_payment must require p_idempotency_key",
  );
  expectMatch(
    shippingReceipt,
    /p_idempotency_key:\s*string/,
    "record_shipping_fee_payment must require p_idempotency_key",
  );
  expectMatch(
    manualReceipt,
    /p_expected_received_amount:\s*number/,
    "record_manual_transfer_payment must require the observed ledger total",
  );
  expectMatch(
    shippingReceipt,
    /p_expected_received_amount:\s*number/,
    "record_shipping_fee_payment must require the observed ledger total",
  );
  expectMatch(
    manualReceipt,
    /p_expected_ledger_entry_count:\s*number/,
    "record_manual_transfer_payment must require the observed ledger version",
  );
  expectMatch(
    shippingReceipt,
    /p_expected_ledger_entry_count:\s*number/,
    "record_shipping_fee_payment must require the observed ledger version",
  );
});

test("all three receipt UIs persist one canonical key until a successful response", async () => {
  const [operatorConsole, ownerConsole, receiptHelper] = await Promise.all([
    source("src/components/admin/operator/OperatorOrdersConsole.tsx"),
    source("src/components/admin/owner/OwnerOperationsConsole.tsx"),
    source("src/lib/manualTransferReceipt.ts"),
  ]);
  const operatorMutation = section(
    operatorConsole,
    "const mutateLedger = async",
    "const waiting =",
    "operator receipt mutation",
  );
  const auctionMutation = section(
    ownerConsole,
    "const recordAuctionReceipt = async",
    "const recordShippingReceipt = async",
    "owner auction receipt mutation",
  );
  const shippingMutation = section(
    ownerConsole,
    "const recordShippingReceipt = async",
    "const runtimeStatusText =",
    "owner shipping receipt mutation",
  );

  expectMatch(
    receiptHelper,
    /crypto\.subtle\.digest\s*\(\s*"SHA-256"[\s\S]{0,900}window\.sessionStorage\.getItem/i,
    "pending keys must survive a component remount without storing the receipt payload in plaintext",
  );
  expectMatch(
    receiptHelper,
    /MANUAL_TRANSFER_DEPOSITOR_NAME_MAX_LENGTH\s*=\s*80[\s\S]{0,120}MANUAL_TRANSFER_MEMO_MAX_LENGTH\s*=\s*500/i,
    "the UI fingerprint and API must share the 80/500 character contract",
  );
  expectMatch(
    receiptHelper,
    /function\s+storageKey\(actorId:\s*string,\s*scope:\s*string\)[\s\S]{0,260}\$\{STORAGE_PREFIX\}\$\{actorId\}:\$\{scope\}/,
    "pending receipt storage must be isolated by authenticated actor",
  );

  for (const [label, mutation] of [
    ["commerce UI", operatorMutation],
    ["auction UI", auctionMutation],
    ["shipping UI", shippingMutation],
  ]) {
    expectMatch(
      mutation,
      /manualTransferReceiptFingerprint\s*\(/,
      `${label}: the request must fingerprint the canonical payload`,
    );
    expectMatch(
      mutation,
      /getOrCreatePendingManualTransferReceipt\s*\(\s*actorId\s*,\s*(?:receiptScope|pendingScope)/,
      `${label}: the actor-bound pending request key must be reused`,
    );
    expectMatch(
      mutation,
      /clearPendingManualTransferReceipt\s*\(\s*actorId\s*,\s*(?:receiptScope|pendingScope)/,
      `${label}: only the current actor's pending key may be cleared`,
    );
    assertOrdered(
      mutation,
      ["if (!response.ok)", "clearPendingManualTransferReceipt("],
      `${label}: pending key clear path`,
    );
    expectMatch(
      mutation,
      /결과를 확인하지 못했습니다[\s\S]{0,120}같은 내용으로 다시 시도/,
      `${label}: an unknown network outcome must not be reported as a definite failure`,
    );
    expectMatch(
      mutation,
      /outcomeDefinitive\s*=\s*payload\?\.outcome\s*===\s*"rejected"[\s\S]{0,800}requestStarted\s*&&\s*!outcomeDefinitive/,
      `${label}: only an explicit API rejection may be treated as a definitive failure`,
    );
    assert.doesNotMatch(
      mutation,
      /response\.status\s*<\s*500/,
      `${label}: HTTP status alone must not turn a transport failure into a definitive rejection`,
    );
    expectMatch(
      mutation,
      /readIdempotentReplay\s*\([\s\S]*?idempotentReplay\s*===\s*null[\s\S]*?clearPendingManualTransferReceipt\s*\(/,
      `${label}: malformed success JSON must keep the retry key until the replay marker is known`,
    );
    expectMatch(
      mutation,
      /idempotentReplay[\s\S]{0,180}기존[^\n"]*입금[^\n"]*영수증[^\n"]*확인[^\n"]*새 입금은 추가되지 않았습니다/,
      `${label}: a replay must not be announced as a newly appended receipt`,
    );
  }

  expectMatch(
    operatorConsole,
    /useSupabaseSession\s*\(\)[\s\S]*loadedSessionRevision\s*===\s*sessionRevision[\s\S]*const\s+visibleActiveTransfers\s*=\s*useMemo\s*\([\s\S]{0,180}snapshotIsCurrent\s*\?\s*activeTransfers\s*:\s*\[\][\s\S]{0,300}snapshotIsCurrent\s*\?\s*historyTransfers\s*:\s*\[\]/,
    "the shared operator queue must hide the previous identity's rows during a session transition",
  );
  expectMatch(
    operatorMutation,
    /auth\.getSession\s*\(\)[\s\S]{0,300}latestSession\.access_token\s*!==\s*expectedToken[\s\S]{0,160}latestSession\.user\.id\s*!==\s*expectedActorId[\s\S]{0,320}currentSnapshot\.revision\s*!==\s*expectedSessionRevision/,
    "the operator must revalidate token, actor, and session revision immediately before mutation",
  );
  expectMatch(
    operatorConsole,
    /function\s+isActionableTransfer[\s\S]{0,220}awaiting_transfer[\s\S]{0,100}partially_paid[\s\S]{0,120}remainingAmount\s*>\s*0[\s\S]*?\{isActionableTransfer\(transfer\)\s*&&/,
    "cancelled transfers may be shown as history but must not count as payable work or render a receipt form",
  );

  assert.doesNotMatch(
    `${operatorConsole}\n${ownerConsole}`,
    /delete\s+receiptKeys\.current/,
    "editing and reverting a receipt must not discard its retry key",
  );
  assert.ok(
    (operatorConsole.match(/maxLength=\{MANUAL_TRANSFER_DEPOSITOR_NAME_MAX_LENGTH\}/g) ?? []).length >= 1 &&
      (operatorConsole.match(/maxLength=\{MANUAL_TRANSFER_MEMO_MAX_LENGTH\}/g) ?? []).length >= 1 &&
      (ownerConsole.match(/maxLength=\{MANUAL_TRANSFER_DEPOSITOR_NAME_MAX_LENGTH\}/g) ?? []).length >= 2 &&
      (ownerConsole.match(/maxLength=\{MANUAL_TRANSFER_MEMO_MAX_LENGTH\}/g) ?? []).length >= 2,
    "all receipt forms must enforce the same text bounds used by the canonical fingerprint",
  );
});
