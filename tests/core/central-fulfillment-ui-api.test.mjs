import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("operator fulfillment uses direct-store storage with dated product grids", async () => {
  await access(new URL("src/app/(admin)/admin/operator/fulfillment/page.tsx", rootUrl));
  const [route, consoleSource, layout, migration] = await Promise.all([
    source("src/app/api/admin/operator/fulfillment/route.ts"),
    source("src/app/(admin)/admin/operator/fulfillment/OperatorFulfillmentConsole.tsx"),
    source("src/app/(admin)/admin/operator/layout.tsx"),
    source("supabase/migrations/20260724063531_simplify_direct_store_fulfillment.sql"),
  ]);

  assert.match(route, /"get_direct_store_fulfillment_groups"/);
  assert.match(route, /"store_paid_items",\s*"store_requested_items"/);
  assert.match(route, /"release_buyer_paid_inventory_items"/);
  assert.match(route, /"release_buyer_inventory_shipment_items"/);
  assert.doesNotMatch(route, /record_buyer_inventory_center_items|center_receive|center_store/);
  assert.match(route, /p_date:\s*date/);
  assert.match(route, /new Set\(value\)\.size === value\.length/);
  assert.match(route, /\.sort\(\(a, b\) => a\.id\.localeCompare\(b\.id\)\)/);

  assert.match(consoleSource, /type Action = "store_paid_items" \| "store_requested_items"/);
  assert.match(consoleSource, /type="date"/);
  assert.match(consoleSource, /grid-cols-2[\s\S]*lg:grid-cols-5/);
  assert.match(consoleSource, /CatalogImage/);
  assert.match(consoleSource, /상품 상세보기/);
  assert.match(consoleSource, /선택 상품 출고·보관 완료/);
  assert.doesNotMatch(consoleSource, /센터 입고|보관 위치|목적지/);
  assert.match(layout, /href:\s*"\/admin\/operator\/fulfillment"/);
  assert.doesNotMatch(layout, /\/admin\/operator\/center/);

  assert.match(migration, /current_stage = 'center_stored'/);
  assert.match(migration, /storage_location_code = 'DIRECT_STORE'/);
  assert.match(migration, /direct_store_cutover/);
});

test("center topology and address management surfaces are retired", async () => {
  const [ownerRoute, centerRoute, ownerPage, operatorCenterPage, employeeCenterPage, ownerLayout, dashboard, migration] =
    await Promise.all([
      source("src/app/api/admin/owner/fulfillment/route.ts"),
      source("src/app/api/admin/centers/route.ts"),
      source("src/app/(admin)/admin/owner/fulfillment/page.tsx"),
      source("src/app/(admin)/admin/operator/center/page.tsx"),
      source("src/app/(admin)/admin/employee/center/page.tsx"),
      source("src/app/(admin)/admin/owner/layout.tsx"),
      source("src/components/admin/owner/OwnerDashboard.tsx"),
      source("supabase/migrations/20260724063531_simplify_direct_store_fulfillment.sql"),
    ]);

  assert.match(ownerRoute, /center_topology_removed/);
  assert.match(centerRoute, /center_management_removed/);
  assert.match(ownerRoute, /410/);
  assert.match(centerRoute, /410/);
  assert.match(ownerPage, /redirect\("\/admin\/owner"\)/);
  assert.match(operatorCenterPage, /redirect\("\/admin\/operator\/fulfillment"\)/);
  assert.match(employeeCenterPage, /redirect\("\/admin\/employee\/fulfillment"\)/);
  assert.doesNotMatch(ownerLayout, /센터·매장 구조|\/admin\/owner\/fulfillment/);
  assert.doesNotMatch(dashboard, /센터·매장 구조 설정|\/admin\/owner\/fulfillment/);
  assert.match(migration, /revoke all on function public\.configure_managed_fulfillment_center/);
  assert.match(migration, /revoke all on function public\.configure_store_fulfillment_route/);
  assert.match(migration, /revoke all on function public\.get_my_center_management\(\)/);
});
