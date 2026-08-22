import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("operator intake routes are removed and paid inventory starts storage immediately", async () => {
  const [operatorLayout, employeeLayout, migration, routeMigration] = await Promise.all([
    source("src/app/(admin)/admin/operator/layout.tsx"),
    source("src/app/(admin)/admin/employee/layout.tsx"),
    source("supabase/migrations/20260822181044_start_inventory_storage_at_payment.sql"),
    source("supabase/migrations/20260822184216_retire_legacy_admin_routes.sql"),
  ]);

  await assert.rejects(access(new URL("src/app/api/admin/operator/fulfillment/route.ts", rootUrl)));
  await assert.rejects(access(new URL("src/app/(admin)/admin/operator/fulfillment/page.tsx", rootUrl)));
  assert.doesNotMatch(operatorLayout, /\/admin\/operator\/fulfillment/);
  assert.doesNotMatch(employeeLayout, /\/admin\/employee\/fulfillment/);
  await assert.rejects(access(new URL(
    "src/app/(admin)/admin/operator/fulfillment/OperatorFulfillmentConsole.tsx",
    rootUrl,
  )));

  assert.match(migration, /new\.storage_started_at := new\.paid_at/);
  assert.match(migration, /storage_expires_at = paid_at \+ make_interval/);
  assert.match(migration, /revoke all on function public\.release_buyer_paid_inventory_items/);
  assert.match(migration, /revoke all on function public\.release_buyer_inventory_shipment_items/);
  assert.match(routeMigration, /'\/admin\/operator\/fulfillment' then '\/admin\/operator\/orders'/);
});

test("legacy center and fulfillment aliases are absent", async () => {
  const [ownerLayout, dashboard] = await Promise.all([
      source("src/app/(admin)/admin/owner/layout.tsx"),
      source("src/components/admin/owner/OwnerDashboard.tsx"),
  ]);

  await assert.rejects(access(new URL("src/app/api/admin/owner/fulfillment/route.ts", rootUrl)));
  await assert.rejects(access(new URL("src/app/api/admin/centers/route.ts", rootUrl)));
  for (const path of [
    "src/app/(admin)/admin/owner/fulfillment/page.tsx",
    "src/app/(admin)/admin/operator/center/page.tsx",
    "src/app/(admin)/admin/employee/center/page.tsx",
  ]) {
    await assert.rejects(access(new URL(path, rootUrl)));
  }
  assert.doesNotMatch(ownerLayout, /센터·매장 구조|\/admin\/owner\/fulfillment/);
  assert.doesNotMatch(dashboard, /센터·매장 구조 설정|\/admin\/owner\/fulfillment/);
});
