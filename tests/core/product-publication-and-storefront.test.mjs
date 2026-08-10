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
  assert.match(consoleSource, /예약 공개 \(기본\)/);
  assert.match(consoleSource, /Array\.from\(\{ length: 24 \}/);
  assert.match(productRoute, /nextKoreanScheduledHour/);
});

test("store malls expose active, auction, sold, inquiry, and capped premium discovery", async () => {
  const [migration, desktopStore, mobileStore, feed] = await Promise.all([
    readFile(new URL("supabase/migrations/20260809172131_add_operator_publication_preferences.sql", rootUrl), "utf8"),
    readFile(new URL("src/app/(shop)/stores/[slug]/page.tsx", rootUrl), "utf8"),
    readFile(new URL("src/app/(mobile)/m/stores/[slug]/page.tsx", rootUrl), "utf8"),
    readFile(new URL("src/components/features/auction/AuctionFeedGrid.tsx", rootUrl), "utf8"),
  ]);
  assert.match(migration, /get_public_store_sold_feed_products/);
  assert.match(migration, /plan_code='pro'/);
  for (const source of [desktopStore, mobileStore]) {
    assert.match(source, /즉시구매 상품/);
    assert.match(source, /진행 중 경매/);
    assert.match(source, /판매완료 상품/);
    assert.match(source, /센터 문의/);
  }
  assert.match(desktopStore, /fetchStoreBySlug\(slug\)/);
  assert.match(feed, /storeTier === "premium" \? 1\.2 : 1/);
  assert.match(feed, /top\.length < 8 && count >= 2/);
  assert.match(feed, /센터 · \{source\.storeName\}/);
});
