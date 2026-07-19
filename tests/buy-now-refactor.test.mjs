import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("BUY NOW shop uses an editorial catalog with real-product filters and numbered pagination", async () => {
  const shop = await source("src/components/shop/ShopPage.tsx");

  assert.match(shop, /NINETY-NINE · BUY NOW/);
  assert.match(shop, /SHOP INDEX/);
  assert.match(shop, /AVAILABLE NOW/);
  assert.match(shop, /selectedBrand/);
  assert.match(shop, /selectedCategory/);
  assert.match(shop, /selectedGender/);
  assert.match(shop, /selectedSize/);
  assert.match(shop, /matchesCatalogCategory\(post, selectedCategory\)/);
  assert.match(shop, /matchesCatalogGender\(post, selectedGender\)/);
  assert.match(shop, /getCatalogSizeTokens\(post\)\.has\(selectedSize\)/);
  assert.match(shop, /SHOP_PAGE_SIZE = 20/);
  assert.match(shop, /visibleProducts = fixedProducts\.slice/);
  assert.match(shop, /aria-label="상시 구매 상품 페이지 이동"/);
  assert.match(shop, /aria-label="이전 페이지"/);
  assert.match(shop, /aria-label="다음 페이지"/);
  assert.doesNotMatch(shop, /상시 구매 상품 더 보기/);
  assert.doesNotMatch(shop, /Unsplash|lot099|dummy/i);
});

test("BUY NOW keeps the guarded claim and purchase confirmation flow", async () => {
  const [shop, app, detail] = await Promise.all([
    source("src/components/shop/ShopPage.tsx"),
    source("src/components/AuctionApp.tsx"),
    source("src/components/shop/FixedProductDetailModal.tsx"),
  ]);

  assert.match(shop, /post\.saleType !== "fixed"/);
  assert.match(shop, /post\.status !== "active"/);
  assert.match(shop, /await onBuyNow\(post\)/);
  assert.match(shop, /title="상시 구매 확정"/);
  assert.match(shop, /구매 확정하기/);
  assert.match(app, /claimFixedPriceProduct\(post\.id\)/);
  assert.match(app, /window\.location\.assign\("\/account#payment"\)/);
  assert.match(detail, /onPurchase/);
  assert.match(detail, /서버 재고 확인 후 기존 결제 대기 목록/);
});
