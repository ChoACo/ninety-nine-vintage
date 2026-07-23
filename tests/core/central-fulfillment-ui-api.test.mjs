import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("operator fulfillment splits store and center work through v2 user-context RPCs", async () => {
  await access(new URL("src/app/(admin)/admin/operator/fulfillment/page.tsx", rootUrl));
  const [route, consoleSource, layout] = await Promise.all([
    source("src/app/api/admin/operator/fulfillment/route.ts"),
    source("src/app/(admin)/admin/operator/fulfillment/OperatorFulfillmentConsole.tsx"),
    source("src/app/(admin)/admin/operator/layout.tsx"),
  ]);

  assert.match(route, /authenticateStaffRequest\(request,\s*true\)/);
  assert.match(route, /auth\.user as unknown as RpcClient/);
  assert.match(route, /"get_central_fulfillment_buyer_groups"/);
  assert.match(route, /"release_buyer_paid_inventory_items"/);
  assert.match(route, /"release_buyer_inventory_shipment_items"/);
  assert.match(route, /"record_buyer_inventory_center_items"/);
  assert.match(route, /value\.length<=100/);
  assert.match(route, /new Set\(value\)\.size===value\.length/);
  assert.match(route, /p_expected_work_version:\s*body\.expectedWorkVersion/);
  assert.match(route, /const ordered=body\.inventoryItemIds\.map/);
  assert.match(route, /\.sort\(\(a,b\)=>a\.id\.localeCompare\(b\.id\)\)/);
  assert.match(route, /p_inventory_item_ids:ordered\.map\(\(item\)=>item\.id\)/);
  assert.match(route, /p_expected_versions:ordered\.map\(\(item\)=>item\.version\)/);
  assert.match(route, /p_idempotency_key:\s*body\.idempotencyKey/);
  assert.doesNotMatch(route, /auth\.admin[\s\S]*\.(?:update|insert|upsert|delete)\(/);
  assert.doesNotMatch(
    route,
    /get_store_fulfillment_queue|advance_store_fulfillment_work|mark_shipping_request_shipped|get_shipping_work/,
  );

  assert.match(consoleSource, /inventoryItemIds:items\.map/);
  assert.match(consoleSource, /action:group\.action/);
  assert.match(consoleSource, /expectedWorkVersion:group\.workVersion/);
  assert.match(consoleSource, /expectedVersions:items\.map/);
  assert.match(consoleSource, /crypto\.randomUUID\(\)/);
  assert.match(consoleSource, /센터 → 구매자 → 상품|구매자별 출고·입고·보관/);
  assert.match(consoleSource, /이 구매자 상품 전체 선택/);
  assert.match(consoleSource, /item\.isBlocked/);
  assert.match(consoleSource, /결제 완료[\s\S]{0,80}(?:보관|상품)/);
  assert.match(layout, /href:\s*"\/admin\/operator\/fulfillment"/);
});

test("owner fulfillment explicitly maps every real store to a center and handoff mode", async () => {
  await access(new URL("src/app/(admin)/admin/owner/fulfillment/page.tsx", rootUrl));
  const [route, consoleSource, layout, dashboard] = await Promise.all([
    source("src/app/api/admin/owner/fulfillment/route.ts"),
    source("src/app/(admin)/admin/owner/fulfillment/OwnerFulfillmentConsole.tsx"),
    source("src/app/(admin)/admin/owner/layout.tsx"),
    source("src/components/admin/owner/OwnerDashboard.tsx"),
  ]);

  assert.equal((route.match(/authenticateOwnerAccessRequest\(request\)/g) ?? []).length, 2);
  assert.match(route, /access\.userClient as unknown as RpcClient/);
  assert.match(route, /"configure_store_fulfillment_route"/);
  assert.match(route, /"configure_fulfillment_center_staff_assignment"/);
  assert.match(route, /"get_owner_fulfillment_staff_directory"/);
  assert.doesNotMatch(route, /"configure_fulfillment_center"/);
  assert.match(route, /"configure_managed_fulfillment_center"/);
  assert.match(route, /postalCode|addressLine1|contactName|contactPhone/);
  assert.match(route, /p_store_id:\s*body\.storeId/);
  assert.match(route, /p_fulfillment_center_id:\s*body\.centerId/);
  assert.match(route, /p_user_id:\s*body\.userId/);
  assert.match(route, /p_receive_at_center:\s*body\.receiveAtCenter/);
  assert.match(route, /p_create_shipments:\s*body\.createShipments/);
  assert.match(route, /p_route_mode:\s*body\.routeMode/);
  assert.match(route, /p_expected_version:\s*body\.expectedVersion/);
  assert.match(route, /ROUTE_MODES\s*=\s*new Set\(\["transfer",\s*"co_located"\]\)/);
  assert.match(route, /"get_owner_inventory_fulfillment_configuration"/);
  assert.doesNotMatch(route, /\.from\("store_fulfillment_routes"\)/);
  assert.doesNotMatch(route, /access\.admin[\s\S]*\.(?:update|insert|upsert|delete)\(/);
  assert.match(route, /error\.code\s*===\s*"55000"/);
  assert.match(route, /error:\s*"fulfillment_conflict"/);

  assert.match(consoleSource, /expectedVersion,\s*idempotencyKey:\s*idempotency\.value/);
  assert.match(consoleSource, /routeMode:\s*"transfer"\s*\|\s*"co_located"/);
  assert.match(consoleSource, /draft\.routeMode\s*===\s*"transfer"/);
  assert.match(consoleSource, /draft\.routeMode\s*===\s*"co_located"/);
  assert.match(consoleSource, /receiveAtCenter:\s*assignmentReceive/);
  assert.match(consoleSource, /createShipments:\s*assignmentShip/);
  assert.match(consoleSource, /운영자·직원 센터 배정/);
  assert.match(consoleSource, /매장 이름이나 식별자를 자동으로 추론하지 않습니다/);
  assert.match(consoleSource, /우편번호/);
  assert.match(consoleSource, /기본 주소/);
  assert.match(consoleSource, /담당자/);
  assert.match(consoleSource, /연락처/);
  assert.match(consoleSource, /센터로 이동/);
  assert.match(consoleSource, /같은 장소 즉시 센터 입고/);
  assert.match(consoleSource, /reconciliation_required/);
  assert.match(consoleSource, /href="\/admin\/operator\/fulfillment"/);
  assert.match(layout, /href:\s*"\/admin\/owner\/fulfillment"/);
  assert.match(dashboard, /href="\/admin\/owner\/fulfillment"/);
});
