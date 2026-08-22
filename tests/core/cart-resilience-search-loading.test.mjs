import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("cart reads remain RLS scoped and degrade without discarding products", async () => {
  const [route, cart] = await Promise.all([
    source("src/app/api/cart/route.ts"),
    source("src/components/features/commerce/CartView.tsx"),
  ]);

  assert.match(route, /authenticateMemberRlsRequest\(request\)/);
  assert.match(route, /from\("cart_items"\)[\s\S]*\.eq\("member_id", auth\.userId\)/);
  assert.match(route, /reservation RPC failed; using RLS table fallback/);
  assert.match(route, /shippingAvailable/);
  assert.doesNotMatch(route, /shipping_fee_unavailable" \}, 503/);
  assert.match(cart, /useCommerceStore\.getState\(\)\.cartIds/);
  assert.match(cart, /\/api\/products\?saleType=fixed&limit=100/);
  assert.match(cart, /rendered cached products/);
  assert.doesNotMatch(cart, /장바구니 서버 응답을 확인하지 못했습니다/);
});

test("shop result count uses a stable loading skeleton instead of zero", async () => {
  const feed = await source("src/components/features/auction/AuctionFeedGrid.tsx");

  assert.match(feed, /aria-label="상품 수 불러오는 중"/);
  assert.match(feed, /h-4 w-16 animate-pulse/);
  assert.doesNotMatch(feed, /loading \? "0개 상품"/);
});
