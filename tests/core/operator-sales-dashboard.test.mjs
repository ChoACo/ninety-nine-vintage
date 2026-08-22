import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("operator sales dashboard exposes the requested analytics deck", async () => {
  const [consoleSource, header, metrics, charts, ledger, skeleton, store] = await Promise.all([
    source("src/components/admin/operator/OperatorSalesConsole.tsx"),
    source("src/components/admin/operator/sales/SalesHeaderFilter.tsx"),
    source("src/components/admin/operator/sales/SalesMetricCards.tsx"),
    source("src/components/admin/operator/sales/SalesChartsDeck.tsx"),
    source("src/components/admin/operator/sales/SalesLedgerTable.tsx"),
    source("src/components/admin/operator/sales/SalesSkeleton.tsx"),
    source("src/store/useSalesDateRangeStore.ts"),
  ]);
  assert.match(header, /오늘/);
  assert.match(header, /30일/);
  assert.match(header, /엑셀 다운로드/);
  assert.match(metrics, /총 결제 매출액/);
  assert.match(metrics, /라이브 옥션 매출/);
  assert.match(metrics, /아카이브 숍 매출/);
  assert.match(metrics, /실 정산 예정액/);
  assert.match(charts, /#f59e0b/);
  assert.match(charts, /#6366f1/);
  assert.match(ledger, /주문번호, 상품명, 구매자 검색/);
  assert.match(ledger, /선택한 기간의 판매 내역이 없습니다/);
  assert.match(skeleton, /Array\.from\(\{ length: 6 \}/);
  assert.match(store, /SalesRangePreset/);
  assert.match(consoleSource, /Promise\.all/);
});
