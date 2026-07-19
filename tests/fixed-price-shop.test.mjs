import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("keeps the fixed-price shop prop-driven and separate from auction cards", async () => {
  const [route, app, shop, fixedDetail, home] = await Promise.all([
    source("app/shop/page.tsx"),
    source("src/components/AuctionApp.tsx"),
    source("src/components/shop/ShopPage.tsx"),
    source("src/components/shop/FixedProductDetailModal.tsx"),
    source("src/components/home/HomeLanding.tsx"),
  ]);

  assert.match(route, /<AuctionApp page="shop"/);
  assert.match(shop, /onBuyNow: \(post: AuctionPost\)/);
  assert.match(shop, /post\.saleType !== "fixed"/);
  assert.match(shop, /post\.status !== "active"/);
  assert.match(shop, /publishAt > now\.getTime\(\)/);
  assert.match(shop, /fixedPriceOf\(post\)/);
  assert.match(shop, /disabled=\{!fixedPrice \|\| isBuying\}/);
  assert.match(shop, /await onBuyNow\(post\)/);
  assert.match(shop, /BUY NOW · 결제하기/);
  assert.match(shop, /title="상시 구매 확정"/);
  assert.match(shop, /구매 확정하기/);
  assert.match(shop, /<FixedProductDetailModal/);
  assert.doesNotMatch(shop, /beginManualBankTransfer|placeBid|postgres_changes/);

  assert.match(fixedDetail, /서버 재고 확인 후 기존 결제 대기 목록/);
  assert.match(app, /claimFixedPriceProduct\(post\.id\)/);
  assert.match(app, /window\.location\.assign\("\/account#payment"\)/);
  assert.match(
    app,
    /draft\.saleType === "fixed"[\s\S]*refreshFixedPriceProducts\(\)/,
  );
  assert.match(
    app,
    /draft\.saleType === "fixed"[\s\S]*window\.location\.assign\("\/shop"\)/,
  );

  assert.match(home, /post\.saleType === "auction"/);
  assert.match(home, /post\.saleType === "fixed"/);
  assert.match(home, /href="\/shop"/);
  assert.match(home, /기다림 없는 상시 구매/);
});

test("shows the truthful daily drop and unsold re-entry schedule", async () => {
  const banner = await source(
    "src/components/commerce/CommerceScheduleBanner.tsx",
  );

  assert.match(banner, /time: "10:00"/);
  assert.match(banner, /신상품 공개/);
  assert.match(banner, /time: "22:00"/);
  assert.match(banner, /유찰 상품 재입찰/);
  assert.match(banner, /aria-label="나인티 나인 빈티지 상품 공개 일정"/);
});
