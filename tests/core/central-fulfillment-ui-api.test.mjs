import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("operator intake is retired and paid inventory starts storage immediately", async () => {
  const [route, page, operatorLayout, employeeLayout, migration] = await Promise.all([
    source("src/app/api/admin/operator/fulfillment/route.ts"),
    source("src/app/(admin)/admin/operator/fulfillment/page.tsx"),
    source("src/app/(admin)/admin/operator/layout.tsx"),
    source("src/app/(admin)/admin/employee/layout.tsx"),
    source("supabase/migrations/20260822181044_start_inventory_storage_at_payment.sql"),
  ]);

  assert.match(route, /operator_fulfillment_retired/);
  assert.match(route, /410/);
  assert.doesNotMatch(route, /release_buyer_|get_direct_store_fulfillment_groups/);
  assert.match(page, /redirect\("\/admin\/operator\/storage"\)/);
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
});

test("legacy center aliases lead to current storage and shipping workspaces", async () => {
  const [ownerPage, operatorCenterPage, employeeCenterPage, ownerLayout, dashboard] =
    await Promise.all([
      source("src/app/(admin)/admin/owner/fulfillment/page.tsx"),
      source("src/app/(admin)/admin/operator/center/page.tsx"),
      source("src/app/(admin)/admin/employee/center/page.tsx"),
      source("src/app/(admin)/admin/owner/layout.tsx"),
      source("src/components/admin/owner/OwnerDashboard.tsx"),
    ]);

  await assert.rejects(access(new URL("src/app/api/admin/owner/fulfillment/route.ts", rootUrl)));
  await assert.rejects(access(new URL("src/app/api/admin/centers/route.ts", rootUrl)));
  assert.match(ownerPage, /redirect\("\/admin\/owner"\)/);
  assert.match(operatorCenterPage, /redirect\("\/admin\/operator\/storage"\)/);
  assert.match(employeeCenterPage, /redirect\("\/admin\/employee\/parcels"\)/);
  assert.doesNotMatch(ownerLayout, /센터·매장 구조|\/admin\/owner\/fulfillment/);
  assert.doesNotMatch(dashboard, /센터·매장 구조 설정|\/admin\/owner\/fulfillment/);
});
