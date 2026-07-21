import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/20260721143000_grant_service_role_server_table_access.sql",
  import.meta.url,
);

const expectedSelectTables = [
  "account_access_roles",
  "commerce_order_items",
  "commerce_order_transfers",
  "commerce_orders",
  "kakao_member_profiles",
  "kakao_profile_requirements",
  "manual_transfer_orders",
  "manual_transfer_payment_ledger",
  "member_accounts",
  "payment_attempts",
  "payment_orders",
  "products",
  "profiles",
  "security_activity_logs",
  "shipping_credit_ledger",
  "shipping_fee_payments",
  "shipping_requests",
  "site_status",
  "stores",
  "support_conversations",
  "support_messages",
];

function normalizedStatements(sql) {
  return sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((statement) => statement.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
}

test("service-role server table access is explicit on clean Supabase projects", async () => {
  const statements = normalizedStatements(await readFile(migrationUrl, "utf8"));
  const resetGrant = statements.find((statement) =>
    statement.startsWith("revoke all privileges on table "),
  );
  const selectGrant = statements.find((statement) =>
    statement.startsWith("grant select on table "),
  );

  assert.ok(resetGrant, "legacy service-role ACLs must be normalized first");
  assert.ok(selectGrant, "one auditable service-role SELECT grant must exist");
  for (const table of expectedSelectTables) {
    assert.match(resetGrant, new RegExp(`\\bpublic\\.${table}\\b`));
    assert.match(selectGrant, new RegExp(`\\bpublic\\.${table}\\b`));
  }
  assert.equal(
    (resetGrant.match(/\bpublic\.[a-z_]+\b/g) ?? []).length,
    expectedSelectTables.length,
    "the ACL reset must cover exactly the inventoried server tables",
  );
  assert.equal(
    (selectGrant.match(/\bpublic\.[a-z_]+\b/g) ?? []).length,
    expectedSelectTables.length,
    "the SELECT grant must not silently expand beyond the server inventory",
  );
  assert.ok(
    statements.includes("grant usage on schema public to service_role"),
  );
});

test("service role gets only the direct server mutations, not settlement writes", async () => {
  const statements = normalizedStatements(await readFile(migrationUrl, "utf8"));
  const expectedMutationGrants = [
    "grant insert on table public.account_access_roles to service_role",
    "grant insert, update on table public.kakao_member_profiles to service_role",
    "grant insert on table public.shipping_fee_payments to service_role",
    "grant update on table public.shipping_requests to service_role",
    "grant insert, update on table public.site_status to service_role",
    "grant insert on table public.support_messages to service_role",
  ];

  for (const grant of expectedMutationGrants) assert.ok(statements.includes(grant));

  const mutationStatements = statements.filter((statement) =>
    /^grant (?:insert|update|delete|truncate|all)\b/.test(statement),
  );
  assert.deepEqual(mutationStatements, expectedMutationGrants);
  assert.doesNotMatch(
    mutationStatements.join("\n"),
    /manual_transfer_payment_ledger|commerce_order_transfers|manual_transfer_orders/,
  );
  assert.equal(
    statements.some((statement) => statement.startsWith("grant execute ")),
    false,
    "table portability must not reopen any settlement RPC",
  );
});
