import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("storefront cart, route highlighting, and shipping totals update in client state", async () => {
  const [detail, header, cart, cartStore] = await Promise.all([
    source("src/components/features/auction/detail/StickyBidPanel.tsx"),
    source("src/components/layout/PcHeader.tsx"),
    source("src/components/features/commerce/CartView.tsx"),
    source("src/store/useCartStore.ts"),
  ]);

  assert.match(detail, /onClick=\{\(\) => void addFixedToCart\(\)\}/);
  assert.doesNotMatch(detail, /<QuickCartModal/);
  assert.match(detail, /이미 장바구니에 담긴 상품입니다/);
  assert.match(detail, /장바구니에 상품을 담았습니다/);
  assert.match(detail, /action: \{ label: "장바구니 바로가기", href: `\$\{basePath\}\/cart` \}/);

  assert.match(header, /pathname\.startsWith\(`\$\{href\}\/`\)/);
  assert.match(header, /after:bg-amber-500/);
  assert.match(header, /aria-current=\{active \? "page" : undefined\}/);

  assert.match(cartStore, /shippingModes:Record<string,CartShippingMode>/);
  assert.match(cart, /state\.shippingModes\.checkout \?\? "ship"/);
  assert.match(cart, /setShippingMode\("checkout", include \? "ship" : "vault"\)/);
  assert.match(cart, /productTotal \+ \(includeShippingFee \? shippingFee : 0\)/);
  assert.match(cart, /transition-all duration-200/);
});
