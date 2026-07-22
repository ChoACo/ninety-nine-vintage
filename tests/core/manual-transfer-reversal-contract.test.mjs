import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const reversalMigrationPath =
  "supabase/migrations/20260722020000_harden_manual_transfer_reversal.sql";
const receiptMigrationPath =
  "supabase/migrations/20260721140000_harden_manual_transfer_confirmation.sql";

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

function assertOrdered(value, tokens, label) {
  let cursor = -1;
  for (const token of tokens) {
    const next = value.indexOf(token, cursor + 1);
    assert.notEqual(next, -1, `${label}: missing token ${token}`);
    assert.ok(next > cursor, `${label}: ${token} is out of order`);
    cursor = next;
  }
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

function functionHeader(value) {
  const returns = value.search(/\breturns\b/i);
  assert.notEqual(returns, -1, "function return type is missing");
  return value.slice(0, returns);
}

function functionResult(value, label) {
  const resultStart = value.lastIndexOf("return jsonb_build_object(");
  assert.notEqual(resultStart, -1, `${label}: reversal result is missing`);
  const result = value.slice(resultStart);
  for (const field of [
    "transfer_kind",
    "transfer_id",
    "ledger_id",
    "reversal_of",
    "received_amount",
    "remaining_amount",
    "status",
    "idempotent_replay",
    "ledger_entry_count",
  ]) {
    expectMatch(
      result,
      new RegExp(`'${field}'\\s*,`, "i"),
      `${label}: reversal result is missing ${field}`,
    );
  }
}

test("reversal migration is transactional, preserves receipt keys, and introduces a separately scoped reversal key", async () => {
  const [migration, receiptMigration] = await Promise.all([
    source(reversalMigrationPath),
    source(receiptMigrationPath),
  ]);
  const sql = migration.trim();

  assert.match(sql, /^begin;/i, "reversal rollout must begin an explicit transaction");
  assert.match(sql, /commit;$/i, "reversal rollout must commit its explicit transaction");
  assert.equal(sql.match(/^begin;$/gim)?.length, 1, "reversal rollout must have one top-level begin");
  assert.equal(sql.match(/^commit;$/gim)?.length, 1, "reversal rollout must have one top-level commit");
  expectMatch(
    migration,
    /lock\s+table\s+public\.manual_transfer_payment_ledger\s+in\s+access\s+exclusive\s+mode\s+nowait\s*;/i,
    "the reversal schema change must fail fast while the ledger is quiescent",
  );

  expectMatch(
    receiptMigration,
    /create\s+unique\s+index[\s\S]{0,240}on\s+public\.manual_transfer_payment_ledger\s*\(\s*recorded_by\s*,\s*idempotency_key\s*\)[\s\S]{0,160}where\s+entry_type\s*=\s*'receipt'/i,
    "the existing receipt-only actor/key uniqueness contract must remain the baseline",
  );
  assert.doesNotMatch(
    migration,
    /drop\s+index[\s\S]{0,180}(?:receipt|recorded_by[\s,_-]*idempotency)/i,
    "the reversal rollout must not replace or drop the receipt replay index",
  );
  expectMatch(
    migration,
    /create\s+unique\s+index[\s\S]{0,240}on\s+public\.manual_transfer_payment_ledger\s*\(\s*recorded_by\s*,\s*idempotency_key\s*\)[\s\S]{0,240}where\s+entry_type\s*=\s*'reversal'[\s\S]{0,120}idempotency_key\s+is\s+not\s+null/i,
    "reversal retries must have their own actor/key partial unique index without colliding with receipts",
  );
  const constraintStart = migration.indexOf(
    "add constraint manual_transfer_payment_ledger_idempotency_contract_check",
  );
  const constraintEnd = migration.indexOf("create unique index", constraintStart);
  assert.ok(constraintStart >= 0 && constraintEnd > constraintStart);
  const constraint = migration.slice(constraintStart, constraintEnd);
  expectMatch(constraint, /entry_type\s*=\s*'reversal'/i, "the key contract must cover reversals");
  expectMatch(constraint, /idempotency_key\s+is\s+null/i, "legacy reversal keys must remain valid");
  expectMatch(
    constraint,
    /idempotency_key\s*~\s*'\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-4/i,
    "a supplied reversal key must be UUID v4",
  );
});

test("both reversal RPCs replace the unsafe overload with a seven-argument target-bound CAS contract", async () => {
  const migration = await source(reversalMigrationPath);
  const arg = (type) => `(?:[a-z_]+\\s+)?${type}`;
  const signature = ["text", "uuid", "uuid", "bigint", "integer", "text", "text"]
    .map(arg)
    .join("\\s*,\\s*");
  const typeSignature =
    "text\\s*,\\s*uuid\\s*,\\s*uuid\\s*,\\s*bigint\\s*,\\s*integer\\s*,\\s*text\\s*,\\s*text";

  for (const name of [
    "reverse_manual_transfer_payment",
    "reverse_shipping_fee_payment",
  ]) {
    const reverse = sqlFunction(migration, name);
    expectMatch(
      functionHeader(reverse),
      new RegExp(`\\(\\s*(?:[a-z_]+\\s+)?${signature}\\s*\\)`, "i"),
      `${name}: the replacement RPC must accept kind, exact target, original ledger, CAS, key, and reason`,
    );
    expectMatch(
      migration,
      new RegExp(
        `drop\\s+function(?:\\s+if\\s+exists)?\\s+public\\.${name}\\s*\\(\\s*uuid\\s*,\\s*text\\s*\\)`,
        "i",
      ),
      `${name}: the obsolete ledger-id/reason overload must be removed`,
    );
    expectMatch(
      migration,
      new RegExp(
        `revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\s*\\(\\s*${typeSignature}\\s*\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*,\\s*service_role`,
        "i",
      ),
      `${name}: replacement RPC privileges must be reset before granting access`,
    );
    expectMatch(
      migration,
      new RegExp(
        `grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\s*\\(\\s*${typeSignature}\\s*\\)\\s+to\\s+authenticated`,
        "i",
      ),
      `${name}: staff API callers need the authenticated replacement grant`,
    );
    functionResult(reverse, name);
  }
});

test("reversal RPCs lock an exact target, compare the observed ledger version, and replay only the same actor payload", async () => {
  const migration = await source(reversalMigrationPath);

  for (const name of [
    "reverse_manual_transfer_payment",
    "reverse_shipping_fee_payment",
  ]) {
    const reverse = sqlFunction(migration, name);
    if (name === "reverse_manual_transfer_payment") {
      expectMatch(
        reverse,
        /from\s+public\.payment_runtime_settings[\s\S]{0,180}for\s+update/i,
        `${name}: manual reversal must lock the runtime mode before payment state`,
      );
    }
    expectMatch(
      reverse,
      /ledger\.id\s*=\s*p_ledger_id[\s\S]{0,700}ledger\.entry_type\s*=\s*'receipt'[\s\S]{0,900}p_expected_transfer_id[\s\S]{0,5000}ledger\.id\s*=\s*p_ledger_id[\s\S]{0,900}p_expected_transfer_id[\s\S]{0,300}for\s+update/i,
      `${name}: the original receipt must be probed and locked by ledger id, kind, and caller-selected target`,
    );
    expectMatch(
      reverse,
      /coalesce\s*\(\s*sum\s*\(\s*case\s+when\s+ledger\.entry_type\s*=\s*'receipt'\s+then\s+ledger\.amount\s+when\s+ledger\.entry_type\s*=\s*'reversal'\s+then\s+-ledger\.amount/i,
      `${name}: CAS must derive the signed total from the append-only ledger`,
    );
    expectMatch(
      reverse,
      /count\s*\(\s*\*\s*\)\s*::\s*integer/i,
      `${name}: CAS must derive the monotonic entry count`,
    );
    expectMatch(
      reverse,
      /v_received\s+is\s+distinct\s+from\s+p_expected_received_amount[\s\S]{0,300}v_ledger_entry_count\s+is\s+distinct\s+from\s+p_expected_ledger_entry_count[\s\S]{0,300}PT409/i,
      `${name}: stale balances and ABA ledger versions must fail before a reversal write`,
    );
    expectMatch(
      reverse,
      /where\s+ledger\.recorded_by\s*=\s*v_actor[\s\S]{0,300}ledger\.idempotency_key\s*=\s*v_key[\s\S]{0,200}ledger\.entry_type\s*=\s*'reversal'/i,
      `${name}: a replay lookup must remain actor-scoped`,
    );
    expectMatch(
      reverse,
      /v_existing\.reversal_of\s+is\s+distinct\s+from\s+p_ledger_id[\s\S]{0,500}v_existing\.memo\s+is\s+distinct\s+from\s+v_reason/i,
      `${name}: a replay key may acknowledge only the same original ledger and canonical reason`,
    );
    expectMatch(
      reverse,
      /v_reason\s+text\s*:=\s*btrim\s*\(\s*coalesce\s*\(\s*p_reason\s*,\s*''\s*\)\s*\)/i,
      `${name}: replay identity must compare a canonicalized reason rather than raw whitespace`,
    );
    expectMatch(
      reverse,
      /v_is_replay\s*:=\s*true[\s\S]{0,12000}'reversal_of'\s*,\s*v_entry\.id[\s\S]{0,800}'idempotent_replay'\s*,\s*v_is_replay/i,
      `${name}: a matching replay must return the strict reversal shape`,
    );
    const insertStart = reverse.indexOf(
      "insert into public.manual_transfer_payment_ledger (",
    );
    assert.notEqual(insertStart, -1, `${name}: reversal insert is missing`);
    const insert = reverse.slice(insertStart, insertStart + 1800);
    for (const field of ["entry_type", "reversal_of", "idempotency_key"]) {
      expectMatch(
        insert,
        new RegExp(`\\b${field}\\b`, "i"),
        `${name}: reversal insert must persist ${field}`,
      );
    }
    expectMatch(insert, /'reversal'/i, `${name}: the appended entry must be a reversal`);
    expectMatch(insert, /v_entry\.id/i, `${name}: the reversal must reference the original receipt`);
    expectMatch(insert, /v_key/i, `${name}: the reversal must persist the normalized retry key`);
  }
});

test("ledger reversal API binds the URL target, validates every CAS input, and acknowledges only a strict result", async () => {
  const route = await source(
    "src/app/api/admin/operator/transfers/[id]/ledger/route.ts",
  );
  const start = route.indexOf('if (body.action === "reverse")');
  const end = route.indexOf('return commerceJson({ error: "invalid_request" }', start);
  assert.ok(start >= 0 && end > start, "the API reversal branch must be isolated");
  const reverse = route.slice(start, end);

  expectMatch(reverse, /const\s+targetId\s*=\s*asUuid\(id\)/, "the URL transfer id must be canonical UUID input");
  expectMatch(reverse, /const\s+ledgerId\s*=\s*asUuid\(body\.ledgerId\)/, "the original ledger id must be canonical UUID input");
  expectMatch(reverse, /kind\s*!==\s*"auction"[\s\S]{0,100}kind\s*!==\s*"commerce"[\s\S]{0,100}kind\s*!==\s*"shipping"/, "the API must reject an unknown reversal kind");
  expectMatch(reverse, /p_expected_transfer_kind:\s*kind[\s\S]{0,240}p_expected_transfer_id:\s*targetId[\s\S]{0,240}p_ledger_id:\s*ledgerId[\s\S]{0,240}p_expected_received_amount:\s*expectedReceivedAmount[\s\S]{0,240}p_expected_ledger_entry_count:\s*expectedLedgerEntryCount[\s\S]{0,240}p_idempotency_key:\s*idempotencyKey[\s\S]{0,240}p_reason:\s*reason/, "every reverse RPC call must bind kind, exact target, original ledger, CAS, key, and canonical reason");
  expectMatch(reverse, /!Number\.isSafeInteger\(expectedReceivedAmount\)[\s\S]{0,120}expectedReceivedAmount\s*<\s*0[\s\S]{0,180}!Number\.isSafeInteger\(expectedLedgerEntryCount\)[\s\S]{0,120}expectedLedgerEntryCount\s*<\s*1/, "the API must reject malformed reversal CAS values before RPC dispatch");
  expectMatch(reverse, /reverse_shipping_fee_payment[\s\S]{0,240}reverse_manual_transfer_payment/, "shipping and manual reversal RPCs must share the exact argument object");
  expectMatch(reverse, /const\s+result\s*=\s*asManualTransferReversalResult\(data,\s*kind,\s*targetId,\s*ledgerId\)/, "the API must validate RPC identity against the URL target and requested original ledger");
  expectMatch(reverse, /manual_transfer_reversal_result_unknown[\s\S]{0,160}outcome:\s*"unknown"/, "malformed reversal JSON must remain retry-safe unknown");
  expectMatch(reverse, /outcome\s*===\s*"rejected"\s*\?\s*409\s*:\s*503/, "only a confirmed client/database rejection may be definitive");
  expectMatch(reverse, /result\.idempotent_replay\s*\?\s*200\s*:\s*201/, "replays and new reversals must have distinct success statuses");
  expectMatch(route, /function\s+asManualTransferReversalResult[\s\S]{0,1200}"reversal_of"/, "the strict reversal parser must name reversal_of among its accepted fields");
  expectMatch(route, /function\s+asManualTransferReversalResult[\s\S]{0,1800}Object\.keys\(result\)\.length\s*!==\s*expectedFields\.length/, "the strict reversal parser must reject extra or missing result fields");
  expectMatch(route, /function\s+asManualTransferReversalResult[\s\S]{0,2200}result\.reversal_of\s*!==\s*expectedLedgerId/, "the strict reversal parser must bind reversal_of to the requested original ledger");
});

test("operator reversal retries use a persisted CAS fingerprint and clear it only after strict success", async () => {
  const [orders, helper] = await Promise.all([
    source("src/components/admin/operator/OperatorOrdersConsole.tsx"),
    source("src/lib/manualTransferReceipt.ts"),
  ]);
  const mutationStart = orders.indexOf("const mutateLedger = async");
  const mutationEnd = orders.indexOf("const waiting =", mutationStart);
  assert.ok(mutationStart >= 0 && mutationEnd > mutationStart, "operator ledger mutation must be isolated");
  const mutation = orders.slice(mutationStart, mutationEnd);

  expectMatch(helper, /export\s+async\s+function\s+manualTransferReversalFingerprint[\s\S]{0,900}kind[\s\S]{0,200}targetId[\s\S]{0,200}ledgerId[\s\S]{0,240}reason[\s\S]{0,260}expectedReceivedAmount[\s\S]{0,260}expectedLedgerEntryCount/, "the reversal retry fingerprint must include identity, canonical reason, and the observed CAS snapshot");
  expectMatch(helper, /canonicalizeManualTransferText\(reason,\s*MANUAL_TRANSFER_MEMO_MAX_LENGTH\)/, "the reversal fingerprint must use the same canonical text boundary as the API");
  expectMatch(helper, /function\s+storageKey\(actorId:\s*string,\s*scope:\s*string\)[\s\S]{0,260}\$\{STORAGE_PREFIX\}\$\{actorId\}:\$\{scope\}/, "receipt and reversal keys must retain the existing actor-scoped session-storage format");
  expectMatch(helper, /export\s+async\s+function\s+manualTransferReceiptFingerprint[\s\S]{0,1200}crypto\.subtle\.digest/, "the existing receipt fingerprint must remain available alongside reversal fingerprints");
  expectMatch(helper, /window\.sessionStorage\.getItem[\s\S]{0,900}window\.sessionStorage\.setItem/, "pending receipt and reversal keys must keep the established session-storage lifecycle");
  expectMatch(mutation, /pendingScope\s*=\s*`commerce:\$\{transfer\.id\}:reversal:\$\{ledgerId\}`/, "a reversal must persist a scope tied to its target and original receipt");
  expectMatch(mutation, /manualTransferReversalFingerprint\s*\([\s\S]{0,700}expectedReceivedAmount:\s*transfer\.receivedAmount[\s\S]{0,260}expectedLedgerEntryCount:\s*transfer\.ledgerEntryCount/, "the UI must fingerprint the exact observed CAS snapshot");
  expectMatch(mutation, /requestBody\.idempotencyKey\s*=\s*getOrCreatePendingManualTransferReceipt\s*\(\s*actorId\s*,\s*pendingScope\s*,\s*pendingFingerprint\s*,?\s*\)/, "a rerender or retry must reuse the stored reversal key");
  expectMatch(mutation, /fetch\(`\/api\/admin\/operator\/transfers\/\$\{transfer\.id\}\/ledger`[\s\S]{0,700}JSON\.stringify\(requestBody\)/, "the UI must post a reversal to the exact target URL");
  expectMatch(mutation, /readManualTransferReversalReplay\s*\(payload,[\s\S]{0,700}ledgerEntryCount:\s*transfer\.ledgerEntryCount\s*\+\s*1/, "the UI must accept reversal success only after checking the resulting ledger version");
  expectMatch(mutation, /idempotentReplay\s*===\s*null\s*\|\|\s*response\.status\s*!==\s*\(idempotentReplay\s*\?\s*200\s*:\s*201\)/, "a malformed or status-inconsistent reversal result must keep its retry key");
  assertOrdered(mutation, ["readManualTransferReversalReplay", "outcomeDefinitive = true", "clearPendingManualTransferReceipt("], "reversal pending-key clear path");
});
