import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("owner center management exposes an audited Standard and Pro toggle", async () => {
  const [migration, route, consoleSource] = await Promise.all([
    source("supabase/migrations/20260826210000_enforce_uniform_commission_and_owner_plan_toggle.sql"),
    source("src/app/api/admin/owner/stores/route.ts"),
    source("src/components/admin/owner/OwnerStoreManagementConsole.tsx"),
  ]);

  assert.match(migration, /create or replace function public\.set_owner_store_service_plan/i);
  assert.match(migration, /app_private\.require_grade_zero_owner\(\)/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /p_expected_version/i);
  assert.match(migration, /'plan_change'/i);
  assert.match(route, /action === "plan_change"/);
  assert.match(route, /access\.userClient\.rpc\(/);
  assert.match(consoleSource, /Pro 센터/);
  assert.match(consoleSource, /일반 센터/);
});

test("seller center has a Pro application tab backed by the existing approval workflow", async () => {
  const [workspace, route, migration] = await Promise.all([
    source("src/components/operator/platform/StoreSettingsWorkspace.tsx"),
    source("src/app/api/admin/operator/platform/route.ts"),
    source("supabase/migrations/20260826210000_enforce_uniform_commission_and_owner_plan_toggle.sql"),
  ]);

  assert.match(workspace, /role="tablist"/);
  assert.match(workspace, /Pro 등급 신청/);
  assert.match(workspace, /action: "request_plan"/);
  assert.match(workspace, /일반·Pro 모두 동일하게 5%/);
  assert.match(route, /request_store_service_plan/);
  assert.match(migration, /이미 Pro 등급이 적용된 센터입니다/);
  assert.match(migration, /idempotentReplay/);
});

test("new commission policy fixes future calculation and onboarding at five percent", async () => {
  const [migration, route, policy] = await Promise.all([
    source("supabase/migrations/20260826210000_enforce_uniform_commission_and_owner_plan_toggle.sql"),
    source("src/app/api/admin/owner/stores/route.ts"),
    source("src/lib/legalPolicies.ts"),
  ]);

  assert.match(migration, /select 0\.05::numeric/i);
  assert.doesNotMatch(migration, /0\.035/);
  assert.match(route, /p_commission_rate: 0\.05/);
  assert.doesNotMatch(route, /Number\(body\.commissionRate\)/);
  assert.match(policy, /센터 등급과 관계없이 5%로 고정/);
  assert.doesNotMatch(policy, /3\.5%/);
});
