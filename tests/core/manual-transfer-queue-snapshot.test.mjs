import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const migrationPath =
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

test("shared commerce queue migration is atomic and staff-only", async () => {
  const migration = (await source(migrationPath)).trim();
  const queue = sqlFunction(migration, "get_shared_commerce_payment_queue_page");

  assert.match(migration, /^begin;/i);
  assert.match(migration, /commit;$/i);
  assert.equal(migration.match(/^begin;$/gim)?.length, 1);
  assert.equal(migration.match(/^commit;$/gim)?.length, 1);
  expectMatch(
    migration,
    /set\s+local\s+lock_timeout\s*=\s*'5s'[\s\S]{0,80}set\s+local\s+statement_timeout\s*=\s*'5min'/i,
    "index DDL must abort instead of waiting indefinitely behind payment writers",
  );
  expectMatch(
    queue,
    /language\s+plpgsql[\s\S]{0,80}\bstable\b[\s\S]{0,80}security\s+definer[\s\S]{0,80}set\s+search_path\s*=\s*''/i,
    "the read RPC must run as one stable, search-path-pinned security boundary",
  );
  expectMatch(
    queue,
    /auth\.uid\(\)\s+is\s+null\s+or\s+not\s+public\.is_staff\(\)[\s\S]{0,120}42501/i,
    "anonymous, members, and employees must fail the database authorization check",
  );
  expectMatch(
    queue,
    /\(p_history_before_activity_at\s+is\s+null\)\s*<>\s*\(p_history_before_transfer_id\s+is\s+null\)[\s\S]{0,260}isfinite\(p_history_before_activity_at\)/i,
    "the timestamp and UUID cursor must be paired and finite",
  );
  expectMatch(
    migration,
    /revoke\s+all\s+on\s+function\s+public\.get_shared_commerce_payment_queue_page[\s\S]{0,220}from\s+public,\s*anon,\s*authenticated,\s*service_role/i,
    "every ambient execute grant, including service role, must be removed",
  );
  expectMatch(
    migration,
    /grant\s+execute\s+on\s+function\s+public\.get_shared_commerce_payment_queue_page[\s\S]{0,180}to\s+authenticated/i,
    "only authenticated callers may enter the function before its staff check",
  );
});

test("active, history, CAS balance, and recent ledger share one SQL statement snapshot", async () => {
  const migration = await source(migrationPath);
  const queue = sqlFunction(migration, "get_shared_commerce_payment_queue_page");

  assert.equal(
    queue.match(/^\s*with\s*$/gim)?.length,
    1,
    "all queue data reads must be rooted in one WITH statement",
  );
  expectMatch(
    queue,
    /active_probe\s+as\s+materialized[\s\S]{0,2200}status\s+in\s*\(\s*'awaiting_transfer',\s*'partially_paid'\s*\)[\s\S]{0,160}limit\s+401/i,
    "the active lane must probe one overflow sentinel row",
  );
  expectMatch(
    queue,
    /count\(\*\)::integer\s+as\s+active_count[\s\S]{0,100}count\(\*\)\s*>\s*400\s+as\s+active_overflow/i,
    "the 401st active transfer must fail closed without a partial queue",
  );
  expectMatch(
    queue,
    /when\s+ledger\.entry_type\s*=\s*'receipt'\s+then\s+ledger\.amount[\s\S]{0,140}when\s+ledger\.entry_type\s*=\s*'reversal'\s+then\s+-ledger\.amount[\s\S]{0,180}count\s*\(\s*ledger\.id\s*\)::bigint/i,
    "CAS amount and version must use the complete signed ledger",
  );
  expectMatch(
    queue,
    /greatest\([\s\S]{0,260}confirmed_at[\s\S]{0,220}ledger_max_created_at/i,
    "queue activity must include the latest known confirmation or ledger transition",
  );
  expectMatch(
    queue,
    /status\s+in\s*\(\s*'confirmed',\s*'cancelled'\s*\)[\s\S]{0,520}\(\s*history_candidates\.activity_at,\s*history_candidates\.id\s*\)\s*<\s*\(\s*p_history_before_activity_at,\s*p_history_before_transfer_id\s*\)/i,
    "completed history must use a composite activity-time and UUID keyset",
  );
  expectMatch(
    queue,
    /limit\s*\(p_history_limit\s*\+\s*1\)[\s\S]{0,500}limit\s+p_history_limit/i,
    "history must use a one-row lookahead and expose only the requested page",
  );
  expectMatch(
    queue,
    /history_has_more[\s\S]*order\s+by\s+history_page\.activity_at\s+asc,\s*history_page\.id\s+asc[\s\S]{0,80}limit\s+1/i,
    "the next cursor must be the last visible row only when a lookahead exists",
  );
  expectMatch(
    queue,
    /order\s+by\s+ledger\.created_at\s+desc,\s*ledger\.id\s+desc[\s\S]{0,80}limit\s+100/i,
    "display ledger rows must be bounded per transfer with a deterministic tie-breaker",
  );
  expectMatch(
    queue,
    /ledger_history_complete'[\s\S]{0,120}displayed_entry_count\s*=\s*selected\.ledger_entry_count/i,
    "the UI must be told when its bounded ledger display is incomplete",
  );
  assert.doesNotMatch(queue, /to_jsonb\s*\(|select\s+\*/i);
  for (const field of [
    "'id'",
    "'order_id'",
    "'member_id'",
    "'expected_amount'",
    "'received_amount'",
    "'ledger_entry_count'",
    "'remaining_amount'",
  ]) {
    assert.ok(queue.includes(field), `explicit queue field is missing: ${field}`);
  }
});

test("operator API validates the snapshot fail-closed and exposes summary mode", async () => {
  const [route, dashboard, databaseTypes] = await Promise.all([
    source("src/app/api/admin/operator/orders/route.ts"),
    source("src/components/admin/operator/OperatorConsole.tsx"),
    source("src/lib/supabase/database.types.ts"),
  ]);

  assert.equal(
    route.match(/get_shared_commerce_payment_queue_page/g)?.length,
    1,
    "one API request must make exactly one queue snapshot RPC call",
  );
  assert.doesNotMatch(route, /\.from\(\s*"commerce_order_transfers"|get_manual_transfer_ledger_balances/);
  expectMatch(
    route,
    /allowed\s*=\s*new\s+Set\(\["summary",\s*"before",\s*"beforeId"\]\)[\s\S]{0,260}getAll\(key\)\.length\s*>\s*1/i,
    "unknown and repeated query parameters must be rejected",
  );
  expectMatch(
    route,
    /\(before\s*===\s*null\)\s*!==\s*\(beforeId\s*===\s*null\)[\s\S]{0,180}summaryOnly\s*&&\s*before\s*!==\s*null/i,
    "one-sided cursors and summary-plus-cursor requests must be rejected",
  );
  expectMatch(
    route,
    /hasExactlyKeys\(value,\s*SNAPSHOT_KEYS\)[\s\S]{0,1800}activeOverflow\s*!==\s*\(activeCount\s*>\s*400\)/i,
    "unknown JSON and an inconsistent overflow marker must fail closed",
  );
  expectMatch(
    route,
    /const\s+subMillisecond\s*=\s*BigInt[\s\S]{0,120}BigInt\(milliseconds\)\s*\*\s*BigInt\(1000\)\s*\+\s*subMillisecond/,
    "timestamp ordering must retain PostgreSQL microseconds instead of collapsing them to JS milliseconds",
  );
  expectMatch(
    route,
    /expectedActivityKey[\s\S]{0,1200}activityKey\s*!==\s*expectedActivityKey/,
    "the parser must recompute exact activity and complete signed balance from visible ledger evidence",
  );
  expectMatch(route, /completeSignedAmount\s*!==\s*receivedAmount/);
  expectMatch(
    route,
    /requestCursor\s*!==\s*null[\s\S]{0,220}tupleIsStrictlyBefore/,
    "a cursor response must contain only tuples strictly below the requested boundary",
  );
  expectMatch(
    route,
    /snapshot\.activeOverflow[\s\S]{0,140}operator_orders_queue_limit_exceeded[\s\S]{0,180}snapshot\.integrityError[\s\S]{0,140}operator_orders_snapshot_integrity_error/i,
    "overflow and database integrity failures must never render a partial queue",
  );
  expectMatch(
    route,
    /orderStatusMatchesTransfer\(summary\.order_status,\s*transfer\.status\)[\s\S]{0,900}itemStatusMatchesTransfer\(item\.payment_status,\s*transfer\.status\)[\s\S]{0,700}item\.commerce_orders\.status\s*!==\s*summary\.order_status/,
    "a transition between the queue RPC and order-summary RPC must fail closed",
  );
  expectMatch(
    route,
    /summaryOnly\)\s+return\s+commerceJson\(\{\s*activeCount:\s*snapshot\.activeCount\s*\}\)/i,
    "dashboard summary mode must return only the active work count",
  );
  expectMatch(
    dashboard,
    /\/api\/admin\/operator\/orders\?summary=1/,
    "the dashboard must not download and recount the full queue",
  );
  expectMatch(dashboard, /activeCount\?:\s*number/);
  expectMatch(dashboard, /setOrders\(orderData\.activeCount\s*\?\?\s*0\)/);
  expectMatch(
    databaseTypes,
    /get_shared_commerce_payment_queue_page:[\s\S]{0,420}p_history_before_activity_at\?:\s*string(?:\s*\|\s*null)?[\s\S]{0,260}Returns:\s*Json/,
    "generated database types must include the JSON queue RPC",
  );
});

test("operator console resets live history boundaries and deduplicates load-more pages", async () => {
  const consoleSource = await source(
    "src/components/admin/operator/OperatorOrdersConsole.tsx",
  );

  expectMatch(
    consoleSource,
    /\[activeTransfers,\s*setActiveTransfers\]\s*=\s*useState<Transfer\[\]>\(\[\]\)[\s\S]{0,120}\[historyTransfers,\s*setHistoryTransfers\]\s*=\s*useState<Transfer\[\]>\(\[\]\)/,
    "active work and accumulated history must use separate state",
  );
  expectMatch(
    consoleSource,
    /before=\$\{encodeURIComponent\(cursor\.activityAt\)\}[\s\S]{0,80}beforeId=\$\{encodeURIComponent\(cursor\.transferId\)\}/,
    "load-more must send the complete composite cursor",
  );
  expectMatch(
    consoleSource,
    /const\s+historyById\s*=\s*new\s+Map[\s\S]{0,320}historyById\.set\(transfer\.id,\s*transfer\)[\s\S]{0,180}historyById\.delete\(activeId\)/,
    "history pages must deduplicate by transfer and remove IDs that are active now",
  );
  expectMatch(
    consoleSource,
    /setHistoryTransfers\(\[\]\)[\s\S]{0,180}setHistoryCursor\(null\)[\s\S]{0,100}setHistoryHasMore\(false\)/,
    "logout and identity transitions must clear accumulated rows and cursor state",
  );
  expectMatch(
    consoleSource,
    /catch\s*\(error\)[\s\S]{0,180}setActiveTransfers\(\[\]\)[\s\S]{0,180}setHistoryTransfers\(\[\]\)[\s\S]{0,220}setForms\(\{\}\)[\s\S]{0,120}setLoadedSessionRevision\(null\)[\s\S]{0,80}throw\s+error/,
    "a failed refresh or load-more request must invalidate every actionable snapshot",
  );
  expectMatch(
    consoleSource,
    /if\s*\(appendHistory\)[\s\S]{0,100}setHistoryLoading\(true\)[\s\S]{0,120}else\s*\{[\s\S]{0,120}setLoadedSessionRevision\(null\)[\s\S]{0,100}setHistoryCursor\(null\)[\s\S]{0,100}setHistoryHasMore\(false\)/,
    "a first-page refresh must invalidate the old cursor before another load-more can supersede it",
  );
  expectMatch(
    consoleSource,
    /await\s+load\(currentSession\.access_token,\s*expectedSessionRevision\)/,
    "a successful receipt or reversal must refresh from the first history page",
  );
  expectMatch(
    consoleSource,
    /const\s+waiting\s*=\s*snapshotIsCurrent\s*\?\s*activeCount\s*:\s*0/,
    "the work counter must come from the authoritative queue snapshot",
  );
  assert.doesNotMatch(consoleSource, /recentHistoryTruncated|최근 100건만 표시/);
});
