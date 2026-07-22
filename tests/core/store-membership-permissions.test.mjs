import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../../supabase/migrations/20260722040000_add_store_memberships_permissions.sql",
  import.meta.url,
);

const source = () => readFile(migrationPath, "utf8");

function expectMatch(value, pattern, message) {
  assert.match(value, pattern, message);
}

test("store membership schema carries explicit store and central permissions", async () => {
  const migration = await source();

  expectMatch(
    migration,
    /create\s+table\s+public\.store_memberships[\s\S]{0,1800}business_id\s+uuid\s+not\s+null[\s\S]{0,300}store_id\s+uuid\s+not\s+null[\s\S]{0,300}user_id\s+uuid\s+not\s+null/i,
    "membership identity must be internal to one business, store, and user",
  );
  expectMatch(
    migration,
    /membership_role\s+text\s+not\s+null[\s\S]{0,100}operator[\s\S]{0,100}employee/i,
    "membership role must snapshot the internal operating relationship",
  );
  for (const permission of [
    "manage_products",
    "publish_products",
    "prepare_orders",
    "confirm_payments",
    "receive_at_center",
    "create_shipments",
    "manage_staff",
    "view_reports",
  ]) {
    expectMatch(
      migration,
      new RegExp(`${permission}\\s+boolean\\s+not\\s+null\\s+default\\s+false`, "i"),
      `${permission} must be an explicit fail-closed flag`,
    );
  }
  expectMatch(
    migration,
    /version\s+bigint\s+not\s+null\s+default\s+0\s+check\s*\(version\s*>=\s*0\)/i,
    "membership changes need an optimistic concurrency version",
  );
  expectMatch(
    migration,
    /foreign\s+key\s*\(store_id\s*,\s*business_id\)[\s\S]{0,160}references\s+public\.stores\s*\(id\s*,\s*business_id\)/i,
    "membership cannot cross the store business boundary",
  );
});
test("legacy projection fails closed and preserves scoped product management", async () => {
  const migration = await source();

  expectMatch(
    migration,
    /where\s+public\.access_role_for_user\(stores\.operator_id\)\s+is\s+distinct\s+from\s+'operator'[\s\S]{0,120}access_role_for_user\(stores\.operator_id\)\s+is\s+distinct\s+from\s+'owner'[\s\S]{0,180}raise\s+exception/i,
    "invalid legacy store assignees must abort while Owner remains an explicit exception",
  );
  expectMatch(
    migration,
    /select[\s\S]{0,500}stores\.operator_id[\s\S]{0,180}'operator'[\s\S]{0,220}true\s*,\s*true\s*,\s*true\s*,\s*true\s*,\s*false\s*,\s*false\s*,\s*true\s*,\s*true[\s\S]{0,180}from\s+public\.stores[\s\S]{0,120}access_role_for_user\(stores\.operator_id\)\s*=\s*'operator'/i,
    "only actual operators retain product and store-operation permissions without central rights",
  );
  expectMatch(
    migration,
    /from\s+public\.account_access_roles\s+as\s+roles[\s\S]{0,180}join\s+public\.stores[\s\S]{0,160}stores\.operator_id\s*=\s*roles\.reports_to_operator_id[\s\S]{0,180}roles\.role_code\s*=\s*'employee'[\s\S]{0,180}access_role_for_user\(stores\.operator_id\)\s*=\s*'operator'/i,
    "employees must be projected only to stores assigned to an actual operator",
  );
  expectMatch(
    migration,
    /create\s+or\s+replace\s+function\s+public\.can_manage_product_store\s*\(p_store_id\s+uuid\)[\s\S]{0,240}public\.has_store_permission\(p_store_id\s*,\s*'manage_products'\)/i,
    "the existing product helper must delegate to explicit membership permissions",
  );
});

test("store and business permission helpers trust auth identity only", async () => {
  const migration = await source();

  expectMatch(
    migration,
    /function\s+public\.has_store_permission\s*\(\s*p_store_id\s+uuid\s*,\s*p_permission\s+text\s*\)/i,
    "the store helper signature must remain stable for fulfillment RPCs",
  );
  expectMatch(
    migration,
    /function\s+public\.has_business_permission\s*\(\s*p_business_id\s+uuid\s*,\s*p_permission\s+text\s*\)/i,
    "the business helper signature must remain stable for center RPCs",
  );
  for (const helper of ["has_store_permission", "has_business_permission"]) {
    const helperPattern = new RegExp(
      `function\\s+public\\.${helper}[\\s\\S]{0,2600}public\\.is_owner\\(\\)[\\s\\S]{0,1600}memberships\\.user_id\\s*=\\s*auth\\.uid\\(\\)[\\s\\S]{0,700}memberships\\.status\\s*=\\s*'active'`,
      "i",
    );
    expectMatch(
      migration,
      helperPattern,
      `${helper} must give Owner implicit access and scope others to auth.uid()`,
    );
  }
  assert.doesNotMatch(
    migration,
    /function\s+public\.(?:has_store_permission|has_business_permission)\s*\([^)]*(?:actor|user_id)/i,
    "permission helpers must never accept a caller-selected actor",
  );
});

test("relationship triggers prevent store and account-role drift", async () => {
  const migration = await source();

  expectMatch(
    migration,
    /create\s+trigger\s+stores_validate_operator_assignment[\s\S]{0,180}before\s+insert\s+or\s+update\s+of\s+operator_id\s*,\s*business_id/i,
    "new and reassigned stores must validate the operator role",
  );
  expectMatch(
    migration,
    /create\s+trigger\s+stores_sync_operator_memberships[\s\S]{0,160}after\s+insert\s+or\s+update\s+of\s+operator_id/i,
    "store assignments must synchronize memberships",
  );
  expectMatch(
    migration,
    /function\s+public\.sync_store_operator_memberships[\s\S]{0,2200}v_assignee_role\s*=\s*'owner'[\s\S]{0,1400}if\s+v_assignee_role\s*=\s*'owner'\s+then\s+return\s+new[\s\S]{0,360}sync_store_membership_relationship\([\s\S]{0,220}'operator'/i,
    "Owner assignment must clear stale explicit memberships and return before operator provisioning",
  );
  expectMatch(
    migration,
    /create\s+trigger\s+account_access_roles_sync_employee_memberships[\s\S]{0,180}after\s+insert\s+or\s+update\s+of\s+role_code\s*,\s*reports_to_operator_id\s+or\s+delete/i,
    "employee role changes must synchronize memberships",
  );
  expectMatch(
    migration,
    /function\s+public\.sync_employee_store_memberships[\s\S]{0,1800}where\s+stores\.operator_id\s*=\s*new\.reports_to_operator_id[\s\S]{0,180}access_role_for_user\(stores\.operator_id\)\s*=\s*'operator'/i,
    "employee synchronization must never create explicit membership for an Owner-assigned store",
  );
  expectMatch(
    migration,
    /담당 매장의 운영자를 먼저 변경한 뒤 운영자 역할을 해제해 주세요/i,
    "an assigned operator role must not be removed",
  );
});

test("Owner access RPC is CAS, idempotent, audited, and the tables remain read-only", async () => {
  const migration = await source();

  expectMatch(
    migration,
    /function\s+public\.set_store_membership_access\s*\([\s\S]{0,500}p_expected_version\s+bigint[\s\S]{0,220}p_idempotency_key\s+uuid/i,
    "the Owner mutation must require CAS and idempotency inputs",
  );
  expectMatch(
    migration,
    /v_actor\s+uuid\s*:=\s*auth\.uid\(\)[\s\S]{0,600}v_actor_role\s*<>\s*'owner'[\s\S]{0,100}public\.is_owner\(\)/i,
    "the RPC must derive and revalidate the real Owner actor",
  );
  expectMatch(
    migration,
    /pg_advisory_xact_lock[\s\S]{0,800}actor_user_id\s*=\s*v_actor[\s\S]{0,100}idempotency_key\s*=\s*p_idempotency_key/i,
    "same-actor idempotency replays must serialize",
  );
  expectMatch(
    migration,
    /v_before\.version\s*<>\s*p_expected_version[\s\S]{0,160}errcode\s*=\s*'40001'/i,
    "stale configuration writes must fail closed",
  );
  expectMatch(
    migration,
    /insert\s+into\s+public\.store_membership_permission_audits[\s\S]{0,1800}'access_configured'[\s\S]{0,500}p_idempotency_key/i,
    "successful configuration must write an actor-bound audit record",
  );
  expectMatch(
    migration,
    /revoke\s+all\s+on\s+function\s+public\.set_store_membership_access[\s\S]{0,180}from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role[\s\S]{0,180}grant\s+execute[\s\S]{0,180}to\s+authenticated/i,
    "only authenticated user sessions may enter the Owner-checked RPC",
  );
  expectMatch(
    migration,
    /revoke\s+all\s+privileges\s+on\s+table[\s\S]{0,180}store_memberships[\s\S]{0,180}store_membership_permission_audits[\s\S]{0,120}from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i,
    "no Data API role may mutate membership tables directly",
  );
  expectMatch(
    migration,
    /store_membership_permission_audits_append_only[\s\S]{0,100}before\s+update\s+or\s+delete\s+or\s+truncate/i,
    "permission audits must be append-only",
  );
});
