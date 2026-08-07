import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("stage 4 migration persists per-operator store scope preferences", async () => {
  const migration = await source(
    "supabase/migrations/20260805050000_operator_store_scope_preferences.sql",
  );
  assert.match(migration, /create table public\.operator_store_scope_preferences/);
  assert.match(migration, /user_id uuid primary key[\s\S]{0,220}references public\.profiles\(id\) on delete cascade/);
  assert.match(migration, /selected_store_id uuid[\s\S]{0,220}references public\.stores\(id\) on delete set null/);
  assert.match(migration, /enable row level security[\s\S]{0,220}force row level security/);
  assert.match(migration, /revoke all on table public\.operator_store_scope_preferences[\s\S]{0,180}from public, anon, authenticated, service_role/);
  assert.match(migration, /grant select, insert, update on table public\.operator_store_scope_preferences[\s\S]{0,180}to authenticated, service_role/);
  for (const action of ["select", "insert", "update"]) {
    assert.match(
      migration,
      new RegExp(
        `Staff ${action === "insert" ? "create" : action === "update" ? "update" : "read"} their store scope preference`,
      ),
    );
    assert.match(
      migration,
      /\(select auth\.uid\(\)\)\s*=\s*user_id/i,
    );
  }
});

test("stage 4 scope RPCs validate the operator and the selected store", async () => {
  const migration = await source(
    "supabase/migrations/20260805050000_operator_store_scope_preferences.sql",
  );
  assert.match(migration, /function public\.get_operator_store_scope\(\)/);
  assert.match(migration, /access_role_for_user\(v_user_id\) not in \('operator', 'owner'\)[\s\S]{0,180}운영자 권한이 필요합니다/);
  assert.match(migration, /jsonb_build_object\('scope', 'all', 'storeId', null\)/);
  assert.match(migration, /grant execute on function public\.get_operator_store_scope\(\) to authenticated/);
  assert.match(migration, /function public\.set_operator_store_scope\(\s*p_scope text,\s*p_store_id uuid default null\s*\)/);
  assert.match(migration, /p_scope not in \('all', 'store'\)[\s\S]{0,180}센터 범위를 확인해 주세요/);
  assert.match(migration, /id = p_store_id and is_active[\s\S]{0,180}활성 센터를 찾을 수 없습니다/);
  assert.match(migration, /public\.has_store_permission\(v_store\.id, 'manage_products'\)[\s\S]{0,180}배정된 센터만 선택할 수 있습니다/);
  assert.match(migration, /insert into public\.operator_store_scope_preferences \(user_id, selected_store_id\)[\s\S]{0,220}on conflict \(user_id\) do update/);
  assert.match(migration, /grant execute on function public\.set_operator_store_scope\(text, uuid\) to authenticated/);
});

test("operator store scope API reads and writes the preference", async () => {
  const route = await source("src/app/api/admin/operator/store-scope/route.ts");
  assert.match(route, /authenticateStaffRequest/);
  assert.match(route, /get_operator_store_scope/);
  assert.match(route, /set_operator_store_scope/);
  assert.match(route, /from\("store_memberships"\)[\s\S]{0,220}eq\("status", "active"\)/);
  assert.match(route, /eq\("membership_role", "operator"\)/);
  assert.match(route, /commerceJson\(\{ scope, stores \}\)/);
});
