import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("canonical architecture uses store or fulfillment-group shipping units", async () => {
  const [principles, flow, domain, policy] = await Promise.all([
    source("docs/architecture/product-principles.md"),
    source("docs/architecture/order-payment-fulfillment-flow.md"),
    source("docs/architecture/domain-model.md"),
    source("docs/architecture/center-commerce-fulfillment-rebuild.md"),
  ]);
  const canonical = [principles, flow, domain, policy].join("\n");

  assert.match(canonical, /store[^\n]*fulfillment_group/i);
  assert.match(canonical, /배송 단위마다 배송비 한 번, 배송 요청 하나, 송장 하나/);
  assert.match(canonical, /연결되지 않은 매장끼리는 합포장(?:·배송 요청)?·송장을 공유하지 않는다/);
  assert.doesNotMatch(principles, /모든 요청 상품[^\n]*송장 하나/);
});

test("canonical policy retires PortOne execution instead of preserving an adapter", async () => {
  const [principles, flow, roles, policy] = await Promise.all([
    source("docs/architecture/product-principles.md"),
    source("docs/architecture/order-payment-fulfillment-flow.md"),
    source("docs/architecture/roles-and-permissions.md"),
    source("docs/architecture/center-commerce-fulfillment-rebuild.md"),
  ]);

  for (const document of [principles, flow, roles, policy]) {
    assert.match(document, /PortOne[^\n]*(폐기|폐기한다)/);
    assert.doesNotMatch(document, /PortOne[^\n]*(어댑터로 보존|코드를 보존|재활성화 준비)/);
  }
});
