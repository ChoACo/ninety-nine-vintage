import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("Owner dashboard removes shop status cards and links center(store) management", async () => {
  await access(
    new URL("src/app/(admin)/admin/owner/stores/page.tsx", rootUrl),
  );
  const [layout, dashboard, page, consoleSource] = await Promise.all([
    source("src/app/(admin)/admin/owner/layout.tsx"),
    source("src/components/admin/owner/OwnerDashboard.tsx"),
    source("src/app/(admin)/admin/owner/stores/page.tsx"),
    source("src/components/admin/owner/OwnerStoreManagementConsole.tsx"),
  ]);

  assert.match(layout, /href:\s*"\/admin\/owner\/stores"/);
  assert.match(layout, /센터\(매장\) 관리/);
  assert.match(dashboard, /센터\(매장\)·인력 배치/);
  assert.doesNotMatch(dashboard, /숍별 운영 현황|숍 운영자/);
  assert.match(page, /OwnerStoreManagementConsole/);
  assert.match(consoleSource, /센터와 매장은 같은 업무 단위입니다/);
  assert.match(consoleSource, /센터\(매장\) 추가/);
  assert.match(consoleSource, /담당 운영자/);
  assert.match(consoleSource, /직원 배치/);
  assert.match(consoleSource, /수정 저장/);
  assert.match(consoleSource, /삭제된 센터\(매장\)/);
});

test("Owner store API is authenticated, origin-checked, and routes mutations through RPCs", async () => {
  const route = await source("src/app/api/admin/owner/stores/route.ts");

  assert.match(route, /authenticateOwnerAccessRequest\(request\)/);
  assert.match(route, /readSmallJsonBody\(request\)/);
  assert.match(route, /"get_owner_store_management"/);
  assert.match(route, /"manage_owner_store"/);
  assert.match(route, /"set_owner_store_employee"/);
  assert.match(route, /p_expected_version:\s*expectedVersion/);
  assert.match(route, /p_expected_store_version:\s*expectedStoreVersion/);
  assert.match(route, /p_idempotency_key:\s*idempotencyKey/);
  assert.doesNotMatch(route, /\.from\("stores"\)\.(?:insert|update|delete)/);
});

test("center(store) migration supports Owner-only CAS CRUD and explicit staff placement", async () => {
  const migration = await source(
    "supabase/migrations/20260724085449_owner_store_center_management.sql",
  );

  assert.match(
    migration,
    /alter table public\.stores[\s\S]{0,180}version bigint not null default 0/,
  );
  assert.match(
    migration,
    /function app_private\.require_grade_zero_owner\(\)[\s\S]{0,800}role_code = 'owner'[\s\S]{0,120}grade_level = 0/,
  );
  assert.match(
    migration,
    /function public\.manage_owner_store\([\s\S]{0,600}p_expected_version bigint[\s\S]{0,300}p_idempotency_key uuid/,
  );
  assert.match(
    migration,
    /v_before\.version <> p_expected_version[\s\S]{0,180}errcode = '55000'/,
  );
  assert.match(
    migration,
    /p_action = 'archive'[\s\S]{0,700}products\.status in \('pending', 'active'\)[\s\S]{0,500}is_active = false/,
  );
  assert.match(
    migration,
    /function public\.set_owner_store_employee\([\s\S]{0,500}p_expected_store_version bigint[\s\S]{0,300}p_expected_membership_version bigint/,
  );
  assert.match(
    migration,
    /sync_store_membership_relationship\([\s\S]{0,220}p_employee_id[\s\S]{0,180}'employee'/,
  );
  assert.match(
    migration,
    /owner_store_management_events[\s\S]{0,1400}unique \(actor_user_id, idempotency_key\)/,
  );
  assert.match(
    migration,
    /pg_advisory_xact_lock\([\s\S]{0,160}v_actor::text[\s\S]{0,120}p_idempotency_key::text/,
  );
  assert.match(
    migration,
    /revoke all on function public\.manage_owner_store[\s\S]{0,220}grant execute on function public\.manage_owner_store[\s\S]{0,180}to authenticated/,
  );
  assert.doesNotMatch(migration, /insert into public\.fulfillment_centers/);
  assert.doesNotMatch(
    migration,
    /for v_employee in[\s\S]{0,600}담당 운영자의 현재 매장에 직원 소속 동기화/,
  );
});
