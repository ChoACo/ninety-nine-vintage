import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  assert.match(route, /set_active_operator_store_scope/);
  assert.match(route, /expectedMode = auth\.roleCode === "owner" \? "owner_support" : "assigned"/);
  assert.match(route, /from\("store_memberships"\)[\s\S]{0,220}eq\("status", "active"\)/);
  assert.match(route, /eq\("membership_role", "operator"\)/);
  assert.match(route, /auth\.admin[\s\S]{0,180}\.from\("stores"\)[\s\S]{0,180}\.eq\("is_active", true\)/);
  assert.match(route, /commerceJson\(\{ scope, stores \}\)/);
});

test("operator store reads stay within the public column grant", async () => {
  const [scopeRoute, productsRoute] = await Promise.all([
    source("src/app/api/admin/operator/store-scope/route.ts"),
    source("src/app/api/admin/operator/products/route.ts"),
  ]);
  assert.match(scopeRoute, /auth\.admin[\s\S]{0,180}\.from\("stores"\)[\s\S]{0,180}\.eq\("is_active", true\)/);
  assert.doesNotMatch(productsRoute, /\.eq\("is_active", true\)/);
  assert.match(productsRoute, /\.select\("id, name, slug"\)/);
  assert.doesNotMatch(productsRoute, /operator_id, is_active/);
});

test("current operator workspace requires one expiring store and removes all-store execution", async () => {
  const [migration, server, route, selector] = await Promise.all([
    source("supabase/migrations/20260809161500_require_expiring_operator_store_scope.sql"),
    source("src/lib/commerce/server.ts"),
    source("src/app/api/admin/operator/products/route.ts"),
    source("src/components/admin/operator/OperatorStoreScopeSelector.tsx"),
  ]);

  assert.match(migration, /delete from public\.operator_store_scope_preferences[\s\S]*selected_store_id is null/i);
  assert.match(migration, /alter column selected_store_id set not null/i);
  assert.match(migration, /access_mode in \('assigned', 'owner_support'\)/i);
  assert.match(migration, /expires_at timestamptz not null[\s\S]*interval '30 minutes'/i);
  assert.match(migration, /membership_role = 'operator'[\s\S]*membership\.status = 'active'/i);
  assert.match(migration, /operator_scope_allows_store[\s\S]*scope\.expires_at > clock_timestamp\(\)/i);
  assert.match(migration, /has_exact_store_or_group_permission[\s\S]*operator_scope_allows_store/i);
  assert.match(migration, /revoke all on function public\.set_operator_store_scope\(text, uuid\)[\s\S]*authenticated/i);
  assert.match(server, /authenticateOperatorStoreRequest[\s\S]*require_active_operator_store_scope/);
  assert.match(route, /authenticateOperatorStoreRequest\(request/);
  assert.match(route, /eq\("id", auth\.selectedStoreId\)/);
  assert.match(route, /storeId !== auth\.selectedStoreId/);
  assert.doesNotMatch(selector, /전체 센터/);
});

test("owner scope preferences are reconciled to the owner support mode", async () => {
  const migration = await source(
    "supabase/migrations/20260811090000_reconcile_owner_operator_store_scope_mode.sql",
  );
  assert.match(migration, /role\.role_code = 'owner'/);
  assert.match(migration, /scope\.access_mode <> 'owner_support'/);
  assert.match(migration, /set access_mode = 'owner_support'[\s\S]*expires_at = clock_timestamp\(\)/);
  assert.match(migration, /v_role = 'owner' and v_row\.access_mode <> 'owner_support'/);
  assert.match(migration, /'accessMode', 'owner_support'/);
  assert.match(migration, /v_role = 'operator' and v_row\.access_mode <> 'assigned'/);
  assert.match(migration, /'accessMode', 'assigned'/);
});

test("every operator API except scope selection requires the active selected store", async () => {
  const apiRoot = fileURLToPath(new URL("src/app/api/admin/operator/", rootUrl));
  const entries = await readdir(apiRoot, { recursive: true, withFileTypes: true });
  const routeFiles = entries
    .filter((entry) => entry.isFile() && entry.name === "route.ts")
    .map((entry) => path.join(entry.parentPath, entry.name));

  for (const routeFile of routeFiles) {
    const route = await readFile(routeFile, "utf8");
    const normalizedRoute = routeFile.replaceAll("\\", "/");
    const isOwnerPaymentRoute =
      normalizedRoute.endsWith("/api/admin/operator/payments/route.ts") ||
      normalizedRoute.endsWith(
        "/api/admin/operator/payments/[kind]/[id]/confirm/route.ts",
      ) ||
      normalizedRoute.endsWith(
        "/api/admin/operator/payments/[kind]/[id]/cancel/route.ts",
      ) ||
      normalizedRoute.endsWith(
        "/api/admin/operator/transfers/[id]/ledger/route.ts",
      );

    if (normalizedRoute.endsWith("/store-scope/route.ts")) {
      assert.match(route, /authenticateStaffRequest/);
    } else if (isOwnerPaymentRoute) {
      assert.match(route, /authenticateOwnerPaymentRequest/, routeFile);
      assert.doesNotMatch(route, /authenticateOperatorStoreRequest/, routeFile);
    } else {
      assert.match(route, /authenticateOperatorStoreRequest/, routeFile);
      assert.doesNotMatch(route, /authenticateStaffRequest/, routeFile);
    }
  }
});
