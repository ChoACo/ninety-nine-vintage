import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);

test("publication preferences persist per operator and store with hourly KST scheduling", async () => {
  const [migration, route, consoleSource, productRoute] = await Promise.all([
    readFile(new URL("supabase/migrations/20260809172131_add_operator_publication_preferences.sql", rootUrl), "utf8"),
    readFile(new URL("src/app/api/admin/operator/products/publication-preference/route.ts", rootUrl), "utf8"),
    readFile(new URL("src/components/admin/operator/OperatorProductsConsole.tsx", rootUrl), "utf8"),
    readFile(new URL("src/app/api/admin/operator/products/route.ts", rootUrl), "utf8"),
  ]);
  assert.match(migration, /primary key \(user_id,store_id\)/i);
  assert.match(migration, /publication_mode in \('now','scheduled'\)/i);
  assert.match(migration, /scheduled_hour_kst between 0 and 23/i);
  assert.match(migration, /has_store_permission\(p_store_id,'manage_products'\)/i);
  assert.match(route, /set_operator_product_publication_preference/);
  assert.match(consoleSource, /useState<PublicationMode>\("scheduled"\)/);
  assert.match(consoleSource, /getAvailablePublishSlots/);
  assert.match(consoleSource, /publishSlots\.map/);
  assert.match(productRoute, /getAvailablePublishSlots\(\)\[0\]\.value/);
  assert.match(productRoute, /body\?\.publicationMode === "now" \? "now" : "scheduled"/);
});

test("store malls split into main, new, auction, buy, and info pages", async () => {
  const [migration, desktopStore, mobileStore, storeExperience, storeInfo, storeTabs, storeSplit, storeDates, storeNew, storeAuction, storeBuy, mobileAbout, feed] = await Promise.all([
    readFile(new URL("supabase/migrations/20260809172131_add_operator_publication_preferences.sql", rootUrl), "utf8"),
    readFile(new URL("src/app/(shop)/stores/[slug]/page.tsx", rootUrl), "utf8"),
    readFile(new URL("src/app/(mobile)/m/stores/[slug]/page.tsx", rootUrl), "utf8"),
    readFile(new URL("src/components/features/catalog/StoreMallExperience.tsx", rootUrl), "utf8"),
    readFile(new URL("src/components/features/catalog/StoreMallStoreInfo.tsx", rootUrl), "utf8"),
    readFile(new URL("src/components/features/catalog/StoreMallTabs.tsx", rootUrl), "utf8"),
    readFile(new URL("src/components/features/catalog/StoreMallSplitSales.tsx", rootUrl), "utf8"),
    readFile(new URL("src/components/features/catalog/StoreMallDateNav.tsx", rootUrl), "utf8"),
    readFile(new URL("src/app/(shop)/stores/[slug]/new/page.tsx", rootUrl), "utf8"),
    readFile(new URL("src/app/(shop)/stores/[slug]/auction/page.tsx", rootUrl), "utf8"),
    readFile(new URL("src/app/(shop)/stores/[slug]/buy/page.tsx", rootUrl), "utf8"),
    readFile(new URL("src/app/(mobile)/m/stores/[slug]/about/page.tsx", rootUrl), "utf8"),
    readFile(new URL("src/components/features/auction/AuctionFeedGrid.tsx", rootUrl), "utf8"),
  ]);
  assert.match(migration, /get_public_store_sold_feed_products/);
  assert.match(migration, /plan_code='pro'/);
  assert.match(storeSplit, /센터 즉시구매관/);
  assert.match(storeSplit, /센터 경매관/);
  assert.match(storeSplit, /grid-cols-2/);
  assert.match(storeExperience, /<StoreMallSplitSales/);
  assert.match(storeExperience, /<StoreMallTabs active="main"/);
  assert.doesNotMatch(storeExperience, /이 센터에서 판매된 상품/);
  assert.match(storeExperience, /CenterStorefrontActions/);
  assert.match(storeExperience, /상품이 있는 날만 골라보기/);
  assert.match(storeTabs, /{ key: "main", label: "📌 센터 홈"/);
  assert.match(storeTabs, /{ key: "new", label: "📦 보관·배송 정책"/);
  assert.match(storeTabs, /{ key: "auction", label: "🔨 실시간 경매"/);
  assert.match(storeTabs, /{ key: "buy", label: "🛍️ 즉시 구매"/);
  assert.match(storeTabs, /{ key: "about", label: "⭐ 구매 후기"/);
  assert.match(storeInfo, /SHOPPING GUIDE/);
  assert.match(storeInfo, /이 센터에 문의하기/);
  for (const source of [desktopStore, mobileStore]) assert.match(source, /fetchStoreProductDates\(store\.id\)/);
  for (const source of [storeNew, storeAuction, storeBuy]) assert.match(source, /resolveStoreCatalogDate\(query\.date, dates\)/);
  assert.match(mobileAbout, /<StoreMallStoreInfo basePath="\/m"/);
  assert.match(storeDates, /dates\.map/);
  assert.doesNotMatch(storeDates, /getRecentCatalogDates/);
  assert.doesNotMatch(storeSplit, /grid-cols-5/);
  assert.doesNotMatch(feed, /storeTier === "premium" \? 1\.2 : 1/);
  assert.match(feed, /const leftScore = score\(left\.id\)/);
  assert.match(feed, /top\.length < 8 && count >= 2/);
  assert.match(feed, /센터 · \{source\.storeName\}/);
});
