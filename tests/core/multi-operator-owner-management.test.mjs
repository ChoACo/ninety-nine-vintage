import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("stage 3 migration exposes multi-operator owner management", async () => {
  const migration = await source(
    "supabase/migrations/20260805040000_owner_multi_operator_management.sql",
  );
  assert.match(migration, /drop constraint if exists owner_store_management_events_action_check/);
  assert.match(migration, /'operator_assign', 'operator_remove'/);
  assert.match(migration, /'operators', coalesce/);
  assert.match(migration, /role_code = 'owner'[\s\S]{0,180}grade_level, 99\) = 0/);
  assert.match(migration, /function public\.set_owner_store_operator\(/);
  assert.match(migration, /p_expected_membership_version bigint default null/);
  assert.match(migration, /v_store\.version <> p_expected_store_version/);
  assert.match(migration, /membership_role = 'operator'[\s\S]{0,180}status = 'active'/);
  assert.match(migration, /대표 운영자를 먼저 변경한 뒤 운영자 소속을 해제해 주세요/);
  assert.match(migration, /grant execute on function public\.set_owner_store_operator/);
  assert.match(migration, /create or replace function public\.manage_owner_store/);
});

test("owner store route validates and calls operator assignment RPC", async () => {
  const route = await source("src/app/api/admin/owner/stores/route.ts");
  assert.match(route, /action === "operator_assign" \|\| action === "operator_remove"/);
  assert.match(route, /const operatorId = readUuid\(body\.operatorId\)/);
  assert.match(route, /p_expected_membership_version: expectedMembershipVersion/);
  assert.match(route, /"set_owner_store_operator"/);
  assert.match(route, /operator_placement_failed/);
});

test("owner store management console assigns and removes additional operators", async () => {
  const console = await source(
    "src/components/admin/owner/OwnerStoreManagementConsole.tsx",
  );
  assert.match(console, /interface StoreOperator/);
  assert.match(console, /operators: StoreOperator\[\]/);
  assert.match(console, /operatorDrafts/);
  assert.match(console, /action: "operator_assign"/);
  assert.match(console, /expectedMembershipVersion: null/);
  assert.match(console, /action: "operator_remove"/);
  assert.match(console, /expectedMembershipVersion: operator\.version/);
  assert.match(console, /함께 운영하는 운영자/);
  assert.match(console, /operator\.userId === store\.operatorId/);
  assert.match(console, /\(소유자\)/);
});
