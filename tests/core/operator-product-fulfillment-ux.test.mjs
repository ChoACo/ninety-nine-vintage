import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("single-product photos expose cover designation and stable left-right ordering", async () => {
  const consoleSource = await source(
    "src/components/admin/operator/OperatorProductsConsole.tsx",
  );

  assert.match(consoleSource, /const setSingleImageAsCover/);
  assert.match(consoleSource, /대표 사진/);
  assert.match(consoleSource, /대표 지정/);
  assert.match(consoleSource, /<ArrowLeft/);
  assert.match(consoleSource, /<ArrowRight/);
  assert.match(
    consoleSource,
    /files: singleImages\.map\(\(image\) => image\.file\)/,
  );
});

test("orders and shipping surfaces share the bundled picking checklist without mutating fulfillment", async () => {
  const [ordersPage, shippingConsole, shippingRoute, productRoute] =
    await Promise.all([
      source("src/app/(admin)/admin/operator/orders/page.tsx"),
      source("src/components/admin/operator/OperatorShippingConsole.tsx"),
      source("src/app/api/admin/operator/shipping/route.ts"),
      source("src/app/api/admin/operator/products/[id]/route.ts"),
    ]);

  assert.match(
    ordersPage,
    /<OperatorShippingConsole presentation="picking-summary" view="requests"/,
  );
  assert.match(shippingConsole, /function PickingListDialog/);
  assert.match(shippingConsole, /activeItems\(shipment\)\.length > 1/);
  assert.match(shippingConsole, /묶음 출고 \{items\.length\}건 피킹 리스트/);
  assert.match(
    shippingConsole,
    /체크 상태는 현장 피킹 확인용이며 출고 상태나 송장 정보는 변경하지 않습니다/,
  );
  assert.match(
    shippingRoute,
    /rpc\("complete_inventory_shipment_with_tracking", \{/,
  );
  assert.match(productRoute, /\.rpc\("update_operator_product", \{/);
});
