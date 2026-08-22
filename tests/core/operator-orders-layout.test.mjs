import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("operator orders use one compact filter bar, dense table, and a dedicated detail drawer", async () => {
  const [consoleSource, filterSource, tableSource, drawerSource, routeSource] = await Promise.all([
    source("src/components/admin/operator/OperatorOrdersConsole.tsx"),
    source("src/components/admin/operator/orders/OrderFilterHeader.tsx"),
    source("src/components/admin/operator/orders/OrderTable.tsx"),
    source("src/components/admin/operator/orders/OrderDetailDrawer.tsx"),
    source("src/app/api/admin/operator/orders/route.ts"),
  ]);

  assert.match(consoleSource, /<OrderFilterHeader/);
  assert.match(consoleSource, /<OrderTable/);
  assert.match(consoleSource, /<OrderDetailDrawer/);
  for (const label of ["전체", "보관함 적재 대기", "즉시 출고 준비", "배송 중", "배송 완료", "취소\/반품"]) assert.match(filterSource, new RegExp(label));
  assert.match(filterSource, /엑셀 다운로드/);
  assert.match(tableSource, /min-w-\[680px\][\s\S]*lg:min-w-\[1180px\]/);
  assert.match(tableSource, /hidden w-32 lg:table-cell/);
  assert.match(tableSource, /h-\[60px\]/);
  assert.match(tableSource, /📦 14일 보관함/);
  assert.match(tableSource, /🚚 즉시 발송/);
  assert.match(drawerSource, /max-w-xl/);
  assert.match(drawerSource, /송장 번호 등록 및 배송 시작/);
  assert.match(routeSource, /\.eq\("store_id", auth\.selectedStoreId\)/);
  assert.match(routeSource, /conditionGrade:/);
  assert.match(routeSource, /buyerMasked:/);
});
