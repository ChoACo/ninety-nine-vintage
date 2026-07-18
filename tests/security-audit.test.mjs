import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260718070000_activity_logs_and_ip_security.sql",
  import.meta.url,
);
const volatilityMigrationUrl = new URL(
  "../supabase/migrations/20260718072000_fix_security_function_volatility.sql",
  import.meta.url,
);
const clientUrl = new URL("../src/lib/securityAudit/client.ts", import.meta.url);
const serverUrl = new URL("../src/lib/securityAudit/server.ts", import.meta.url);
const proxyUrl = new URL("../proxy.ts", import.meta.url);
const ownerPanelUrl = new URL(
  "../src/components/owner/OwnerSecurityAdminPanel.tsx",
  import.meta.url,
);
const memberPanelUrl = new URL(
  "../src/components/security/MemberSecurityLogPanel.tsx",
  import.meta.url,
);

const [migration, volatilityMigration, client, server, proxy, ownerPanel, memberPanel] = await Promise.all([
  readFile(migrationUrl, "utf8"),
  readFile(volatilityMigrationUrl, "utf8"),
  readFile(clientUrl, "utf8"),
  readFile(serverUrl, "utf8"),
  readFile(proxyUrl, "utf8"),
  readFile(ownerPanelUrl, "utf8"),
  readFile(memberPanelUrl, "utf8"),
]);

test("raw security tables have no client or service-role table access", () => {
  for (const table of [
    "security_activity_logs",
    "security_log_access_requests",
    "security_log_access_decisions",
    "security_session_records",
    "security_session_ip_history",
    "security_ip_block_rules",
    "security_ip_block_rule_audit",
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on public\\.${table}[\\s\\S]{0,100}service_role`, "i"),
    );
  }
  assert.doesNotMatch(migration, /grant\s+select\s+on\s+public\.security_/i);
  assert.match(migration, /grant usage on schema app_private to authenticated/);
  assert.doesNotMatch(migration, /revoke all on schema app_private from[^;]*authenticated/);
});

test("cross-member disclosure requires consent, owner approval, masking and snapshot", () => {
  assert.match(migration, /subject_approved[\s\S]+owner_approved/);
  assert.match(migration, /owner_decide_security_log_access/);
  assert.match(migration, /p_access_hours not between 1 and 24/);
  assert.match(migration, /least\(v_request\.requested_to, v_request\.created_at\)/);
  assert.match(migration, /rather than transferring unused amounts[\s\S]+'\{\}'::jsonb/);
  assert.match(migration, /roles\.role_code in \('member', 'band_member'\)/);
  assert.match(migration, /revoke_security_log_access/);
});

test("session history is material-change only and retained for 90 days", () => {
  assert.match(migration, /v_meaningful := v_is_new/);
  assert.match(migration, /last_seen_at < v_now - interval '15 minutes'/);
  assert.match(migration, /latest_user_agent[\s\S]+interval '1 hour'/);
  assert.match(migration, /active browser sessions|활성 브라우저 세션 수/);
  assert.match(migration, /v_session_cutoff timestamptz := v_now - interval '90 days'/);
  assert.match(migration, /observed_at < v_session_cutoff/);
  assert.match(migration, /category = 'session'[\s\S]+occurred_at < v_session_cutoff/);
});

test("IP enforcement RPCs are service-only and guard broad/self lockout", () => {
  assert.match(migration, /is_security_ip_blocked\(p_ip text\)/);
  assert.match(
    migration,
    /revoke all on function public\.is_security_ip_blocked\(text\)[\s\S]+grant execute[\s\S]+service_role/,
  );
  assert.match(migration, /masklen\(v_network\) < 8/);
  assert.match(migration, /masklen\(v_network\) < 32/);
  assert.match(migration, /현재 관리자 세션이 포함된 IP 대역/);
  assert.match(migration, /p_change_reason/);
});

test("server trusts Vercel forwarding first and distinguishes auth and tab sessions", () => {
  const vercelIndex = server.indexOf('request.headers.get("x-vercel-forwarded-for")');
  const forwardedIndex = server.indexOf('request.headers.get("x-forwarded-for")');
  assert.ok(vercelIndex >= 0 && forwardedIndex > vercelIndex);
  assert.match(server, /readVerifiedJwtSessionId/);
  assert.match(migration, /auth_session_id uuid/);
  assert.match(migration, /browser_tab_session_id uuid not null/);
  assert.match(server, /process\.env\.VERCEL === "1"/);
  assert.match(proxy, /"\/api\/security\/session"/);
  assert.match(proxy, /process\.env\.VERCEL === "1"/);
  assert.match(volatilityMigration, /alter function public\.is_security_ip_blocked\(text\) volatile/);
  assert.match(volatilityMigration, /alter function public\.list_my_security_log_access_requests\(\) volatile/);
});

test("owner raw reads use audited POST bodies instead of query-string reasons", () => {
  assert.match(client, /owner\/security\/activity"[\s\S]+method: "POST"/);
  assert.match(client, /OwnerActivityFilters[\s\S]+reason: string/);
  assert.match(client, /OwnerSessionFilters[\s\S]+reason: string/);
  assert.doesNotMatch(client, /queryString/);
  assert.match(migration, /owner\.raw_activity\.viewed/);
  assert.match(migration, /owner\.raw_sessions\.viewed/);
});

test("business triggers record metadata without copying message or payment secrets", () => {
  for (const trigger of [
    "auction_bids_security_activity",
    "products_security_activity",
    "support_messages_security_activity",
    "payment_orders_security_activity",
    "shipping_requests_security_activity",
    "account_access_roles_security_activity",
    "member_warnings_security_activity",
  ]) {
    assert.match(migration, new RegExp(`create trigger ${trigger}`));
  }
  const capture = migration.slice(
    migration.indexOf("capture_business_security_activity"),
    migration.indexOf("-- Retention is deterministic"),
  );
  assert.doesNotMatch(capture, /->> 'body'|->> 'vbank_num'|->> 'phone'|->> 'address'|->> 'payment_id'/);
});

test("security management UI preserves audited reasons and paginates active queues", () => {
  assert.match(ownerPanel, /status: "awaiting_owner_approval"/);
  assert.match(ownerPanel, /status: "approved"/);
  assert.match(ownerPanel, /loadMore\("awaiting_owner_approval"\)/);
  assert.match(ownerPanel, /loadMore\("approved"\)/);
  assert.match(ownerPanel, /changeReason: editor\.changeReason\.trim\(\)/);
  assert.match(ownerPanel, /enabled: !rule\.enabled, changeReason/);
  assert.match(ownerPanel, /item\.authSessionId/);
  assert.match(ownerPanel, /item\.browserTabSessionId/);
  assert.match(memberPanel, /request\.status === "awaiting_owner_approval"[\s\S]{0,100}\|\| request\.status === "approved"/);
  assert.match(memberPanel, /내 동의 처리 이력/);
  assert.match(memberPanel, /request\.status === "awaiting_owner_approval" && request\.isSubject/);
});
