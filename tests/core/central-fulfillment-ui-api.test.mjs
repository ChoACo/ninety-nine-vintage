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
  assert.match(route, /"get_paid_inventory_store_queue"/);
  assert.match(route, /"get_inventory_store_work_queue"/);
  assert.match(route, /"get_inventory_center_queue"/);
  assert.match(route, /"release_paid_inventory_items"/);
  assert.match(route, /"release_inventory_shipment_items"/);
  assert.match(route, /"record_inventory_center_items"/);
  assert.match(route, /inventoryItemIds\.length\s*<=\s*100/);
  assert.match(route, /new Set\(inventoryItemIds\)\.size\s*===\s*inventoryItemIds\.length/);
  assert.match(route, /p_expected_work_version:\s*body\.expectedWorkVersion/);
  assert.match(route, /const\s+expectedVersions\s*=\s*body\.expectedVersions\s+as\s+number\[\]/);
  assert.match(route, /\.map\(\(id,\s*index\)\s*=>\s*\(\{\s*id,\s*version:\s*expectedVersions\[index\]/);
  assert.match(route, /\.sort\(\(left,\s*right\)\s*=>\s*left\.id\.localeCompare\(right\.id\)\)/);
  assert.match(route, /p_inventory_item_ids:\s*orderedItems\.map\(\(item\)\s*=>\s*item\.id\)/);
  assert.match(route, /p_expected_versions:\s*orderedItems\.map\(\(item\)\s*=>\s*item\.version\)/);
  assert.match(route, /const\s+centerExpectedVersions\s*=\s*body\.expectedVersions\s+as\s+number\[\]/);
  assert.match(route, /const\s+orderedCenterItems\s*=\s*inventoryItemIds[\s\S]*?\.sort\(\(left,\s*right\)\s*=>\s*left\.id\.localeCompare\(right\.id\)\)/);
  assert.match(route, /p_inventory_item_ids:\s*orderedCenterItems\.map\(\(item\)\s*=>\s*item\.id\)/);
  assert.match(route, /p_expected_versions:\s*orderedCenterItems\.map\(\(item\)\s*=>\s*item\.version\)/);
  assert.match(route, /p_idempotency_key:\s*body\.idempotencyKey/);
  assert.doesNotMatch(route, /auth\.admin[\s\S]*\.(?:update|insert|upsert|delete)\(/);
  assert.doesNotMatch(
    route,
    /get_store_fulfillment_queue|advance_store_fulfillment_work|mark_shipping_request_shipped|get_shipping_work/,
  );

  assert.match(consoleSource, /inventoryItemIds:\s*selected/);
  assert.match(consoleSource, /action:\s*"release_paid_items"/);
  assert.match(consoleSource, /expectedWorkVersion:\s*work\.version/);
  assert.match(consoleSource, /expectedVersions:\s*candidates\.map\(\(item\)\s*=>\s*item\.version\)/);
  assert.match(consoleSource, /getOrCreateIdempotencyKey\(actorId,\s*scope\)/);
  assert.match(consoleSource, /action:\s*"release_store_items"/);
  assert.match(consoleSource, /action:\s*action\s*===\s*"receive"\s*\?\s*"center_receive"\s*:\s*"center_store"/);
  assert.match(consoleSource, /response\.status\s*===\s*409/);
  assert.match(consoleSource, /다른 담당자가 먼저 처리했습니다/);
  assert.match(consoleSource, /toggleCenterAll/);
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
  assert.doesNotMatch(route, /postalCode|addressLine1|contactName|contactPhone/);
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
  assert.match(consoleSource, /발송인 센터 주소는 수집하지 않습니다/);
  assert.doesNotMatch(consoleSource, /센터 실제 주소/);
  assert.match(consoleSource, /센터로 이동/);
  assert.match(consoleSource, /같은 장소 즉시 센터 입고/);
  assert.match(consoleSource, /reconciliation_required/);
  assert.match(consoleSource, /href="\/admin\/operator\/fulfillment"/);
  assert.match(layout, /href:\s*"\/admin\/owner\/fulfillment"/);
  assert.match(dashboard, /href="\/admin\/owner\/fulfillment"/);
});
