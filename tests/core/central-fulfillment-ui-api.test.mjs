import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("store fulfillment UI uses user-context RPC commands with CAS and idempotency", async () => {
  await access(new URL("src/app/(admin)/admin/operator/fulfillment/page.tsx", rootUrl));
  const [route, consoleSource, layout] = await Promise.all([
    source("src/app/api/admin/operator/fulfillment/route.ts"),
    source("src/app/(admin)/admin/operator/fulfillment/OperatorFulfillmentConsole.tsx"),
    source("src/app/(admin)/admin/operator/layout.tsx"),
  ]);

  assert.match(route, /authenticateStaffRequest\(request, true\)/);
  assert.match(route, /auth\.user as unknown as RpcClient/);
  assert.match(route, /"get_store_fulfillment_queue"/);
  assert.match(route, /"advance_store_fulfillment_work"/);
  assert.match(route, /p_expected_version:\s*body\.expectedVersion/);
  assert.match(route, /p_idempotency_key:\s*body\.idempotencyKey/);
  assert.doesNotMatch(route, /auth\.admin[\s\S]*\.(?:update|insert|upsert|delete)\(/);
  assert.doesNotMatch(route, /mark_shipping_request_shipped|get_shipping_work/);

  assert.match(consoleSource, /expectedVersion:\s*work\.work_version/);
  assert.match(consoleSource, /idempotencyKey:\s*crypto\.randomUUID\(\)/);
  assert.match(consoleSource, /action:\s*"mark_ready" \| "hand_over"/);
  assert.match(consoleSource, /response\.status === 409/);
  assert.match(consoleSource, /최신 목록으로 새로고침/);
  assert.match(consoleSource, /실제로 중앙 출고지에 넘긴 순서대로 기록/);
  assert.match(layout, /href:\s*"\/admin\/operator\/fulfillment"/);
});

test("owner fulfillment UI configures a real center and records item-level receipt through guarded RPCs", async () => {
  await access(new URL("src/app/(admin)/admin/owner/fulfillment/page.tsx", rootUrl));
  const [route, consoleSource, layout, dashboard] = await Promise.all([
    source("src/app/api/admin/owner/fulfillment/route.ts"),
    source("src/app/(admin)/admin/owner/fulfillment/OwnerFulfillmentConsole.tsx"),
    source("src/app/(admin)/admin/owner/layout.tsx"),
    source("src/components/admin/owner/OwnerDashboard.tsx"),
  ]);

  assert.equal((route.match(/authenticateOwnerAccessRequest\(request\)/g) ?? []).length, 3);
  assert.match(route, /access\.userClient as unknown as RpcClient/);
  assert.match(route, /"get_center_fulfillment_queue"/);
  assert.match(route, /"configure_fulfillment_center"/);
  assert.match(route, /"record_center_item_action"/);
  assert.match(route, /access\.userClient[\s\S]*\.from\("fulfillment_centers"\)/);
  assert.doesNotMatch(route, /access\.admin[\s\S]*\.(?:update|insert|upsert|delete)\(/);
  assert.match(route, /error\.code === "55000"/);
  assert.match(route, /error:\s*"fulfillment_conflict"/);

  assert.match(consoleSource, /expectedVersion:\s*selectedCenter\.version/);
  assert.match(consoleSource, /expectedVersion:\s*item\.version/);
  assert.equal((consoleSource.match(/crypto\.randomUUID\(\)/g) ?? []).length, 2);
  assert.match(consoleSource, /type CenterAction = "receive" \| "store" \| "report_issue" \| "resolve_issue"/);
  assert.match(consoleSource, /가상의 주소는 사용하지 않습니다/);
  assert.match(consoleSource, /실물 입고 확인/);
  assert.match(consoleSource, /보관 위치 저장/);
  assert.match(consoleSource, /문제 등록 · 작업 멈춤/);
  assert.match(consoleSource, /확인 완료 · 작업 재개/);
  assert.match(layout, /href:\s*"\/admin\/owner\/fulfillment"/);
  assert.match(dashboard, /href="\/admin\/owner\/fulfillment"/);
});
