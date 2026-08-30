import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("desktop and mobile product details publish product-specific search metadata", async () => {
  const [auctionPage, shopPage, mobileAuctionPage, mobileShopPage, mobileSoldPage] = await Promise.all([
    source("src/app/(shop)/auction/[id]/page.tsx"),
    source("src/app/(shop)/shop/[id]/page.tsx"),
    source("src/app/(mobile)/m/auction/[id]/page.tsx"),
    source("src/app/(mobile)/m/shop/[id]/page.tsx"),
    source("src/app/(mobile)/m/sold/[id]/page.tsx"),
  ]);
  for (const page of [auctionPage, shopPage, mobileAuctionPage, mobileShopPage]) {
    assert.match(page, /generateMetadata/);
    assert.match(page, /buildProductMetadata/);
    assert.match(page, /loadPublishedProductForSeo/);
    assert.match(page, /product=\{product\}/);
  }
  assert.match(auctionPage, /permanentRedirect\(`\/shop\/\$\{id\}`\)/);
  assert.match(mobileAuctionPage, /permanentRedirect\(`\/m\/shop\/\$\{id\}`\)/);
  assert.match(mobileSoldPage, /loadSoldProductForSeo/);
  assert.match(mobileSoldPage, /buildProductJsonLd/);
  assert.match(mobileSoldPage, /buildProductMetadata/);
});

test("product metadata supports Korean and English brand discovery and Product offers", async () => {
  const [seo, detail] = await Promise.all([
    source("src/lib/seo/productSeo.ts"),
    source("src/components/features/auction/detail/AuctionDetailView.tsx"),
  ]);
  assert.match(seo, /\["NIKE", "나이키"\]/);
  assert.match(seo, /\["STUSSY", "스투시"\]/);
  assert.match(seo, /buildProductSearchName/);
  assert.match(seo, /"@type":\s*"Product"/);
  assert.match(seo, /"@type":\s*"Offer"/);
  assert.match(seo, /priceCurrency:\s*"KRW"/);
  assert.match(detail, /type="application\/ld\+json"/);
  assert.match(detail, /buildProductJsonLd/);
});

test("sitemap and internal links expose canonical product routes with product images", async () => {
  const [sitemap, card, rail, splitSales] = await Promise.all([
    source("src/app/sitemap.ts"),
    source("src/components/features/auction/AuctionCard.tsx"),
    source("src/components/features/catalog/ProductRail.tsx"),
    source("src/components/features/catalog/StoreMallSplitSales.tsx"),
  ]);
  assert.match(sitemap, /image_urls/);
  assert.match(sitemap, /images:\s*product\.image_urls\.slice\(0, 15\)/);
  for (const component of [card, rail, splitSales]) {
    assert.match(component, /saleType === "fixed"/);
    assert.match(component, /shop/);
    assert.match(component, /auction/);
  }
});

test("IndexNow notifications are authenticated, same-host and connected to product mutations", async () => {
  const [keyRoute, notifier, cron, createRoute, bulkRoute, publishRoute, mutationRoute] = await Promise.all([
    source("src/app/indexnow-key.txt/route.ts"),
    source("src/lib/seo/indexNow.server.ts"),
    source("src/app/api/cron/seo-indexnow/route.ts"),
    source("src/app/api/admin/operator/products/route.ts"),
    source("src/app/api/admin/operator/products/bulk/route.ts"),
    source("src/app/api/admin/operator/products/[id]/publish/route.ts"),
    source("src/app/api/admin/operator/products/[id]/route.ts"),
  ]);
  assert.match(keyRoute, /INDEXNOW_KEY/);
  assert.match(notifier, /https:\/\/api\.indexnow\.org\/indexnow/);
  assert.match(notifier, /url\.host !== SITE_HOST/);
  assert.match(notifier, /keyLocation/);
  assert.doesNotMatch(notifier, /indexing\.googleapis\.com/);
  assert.match(cron, /process\.env\.CRON_SECRET/);
  assert.match(cron, /urls\.slice\(index \* 100, index \* 100 \+ 100\)/);
  for (const route of [createRoute, bulkRoute, publishRoute, mutationRoute]) {
    assert.match(route, /notifyIndexNow/);
    assert.match(route, /after\(/);
  }
});
