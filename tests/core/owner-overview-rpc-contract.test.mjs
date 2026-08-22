import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("owner overview reads RPC-only shipment data through a bounded owner projection", async () => {
  const [route, migration] = await Promise.all([
    source("src/app/api/admin/owner/overview/route.ts"),
    source("supabase/migrations/20260822132752_add_owner_shipped_inventory_flow_rpc.sql"),
  ]);

  assert.doesNotMatch(route, /\.from\("inventory_shipment_items"\)/);
  assert.match(route, /auth\.user\.rpc\("get_owner_shipped_inventory_flow"/);
  assert.match(migration, /access_role_for_user\(auth\.uid\(\)\) <> 'owner'/);
  assert.match(migration, /shipment_items\.origin_store_id = p_store_id/);
  assert.match(migration, /revoke all on function public\.get_owner_shipped_inventory_flow[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.get_owner_shipped_inventory_flow[\s\S]*to authenticated/);
});
