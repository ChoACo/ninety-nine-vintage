import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inferBrandFromTitle, normalizeProductBrand, toBrandSlug } from "../../src/lib/catalog/brand.ts";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("brand normalization supports NFKC, Unicode and punctuation", () => {
  assert.deepEqual(normalizeProductBrand("  Ｎｉｋｅ   ACG  "), { brand: "Nike ACG", brandSlug: "nike-acg" });
  assert.equal(toBrandSlug("Comme des Garçons!!!"), "comme-des-garçons");
  assert.equal(toBrandSlug("스투시 / 서울"), "스투시-서울");
});

test("legacy title inference removes the size prefix and falls back safely", () => {
  assert.deepEqual(inferBrandFromTitle("[XL] Stussy World Tour"), { brand: "Stussy", brandSlug: "stussy" });
  assert.deepEqual(inferBrandFromTitle(" [M] (Nike) Hoodie"), { brand: "Nike", brandSlug: "nike" });
  assert.deepEqual(inferBrandFromTitle("[M] !!! Nike Hoodie"), { brand: "Nike", brandSlug: "nike" });
  assert.deepEqual(inferBrandFromTitle("[S] !!!"), { brand: "기타", brandSlug: "etc" });
});

test("single writes normalize an omitted brand while bulk writes require an explicit brand", async () => {
  const [singleRoute, bulkRoute] = await Promise.all([
    source("src/app/api/admin/operator/products/route.ts"),
    source("src/app/api/admin/operator/products/bulk/route.ts"),
  ]);
  assert.match(singleRoute, /parseBrandAndSizeFromTitle\(title\)/);
  assert.match(singleRoute, /brand_source:[\s\S]*parsedTitle\.brand/);
  assert.match(bulkRoute, /normalizeProductBrand\(body\.brand\)/);
  assert.match(bulkRoute, /brand_source:\s*"explicit"/);
  const [operatorUpdate, operatorMutation] = await Promise.all([
    source("src/app/api/admin/operator/products/[id]/route.ts"),
    source("supabase/migrations/20260721030000_harden_operator_product_mutations.sql"),
  ]);
  assert.match(operatorUpdate, /parseBrandAndSizeFromTitle\(title\)/);
  assert.match(operatorUpdate, /\.rpc\("update_operator_product"/);
  assert.match(operatorMutation, /brand_slug\s*=\s*v_brand_slug/);
  assert.match(operatorMutation, /brand_source\s*=\s*'explicit'/);
});

test("sold RPCs expose only archive-safe fields with cursor and brand filtering", async () => {
  const migration = await source("supabase/migrations/20260720220000_product_brand_and_sold_archive_seo.sql");
  assert.match(migration, /p_before_id uuid default null/);
  assert.match(migration, /p_brand_slug text default null/);
  assert.match(migration, /get_public_sold_product\(p_product_id uuid\)/);
  assert.match(migration, /get_public_sold_brands\(\)/);
  assert.match(migration, /security definer/g);
  assert.match(migration, /grant execute[\s\S]+to anon, authenticated/g);
  assert.doesNotMatch(migration, /winner\.bidder_id|winner\.user_id|member_id/);
});

test("sold routes own their canonical, structured data and safe 404 boundary", async () => {
  const [shopLayout, soldPage, brandPage, mobileBrandPage, detailPage, sitemap, robots] = await Promise.all([
    source("src/app/(shop)/layout.tsx"),
    source("src/app/(shop)/sold/page.tsx"),
    source("src/app/(shop)/sold/brand/[slug]/page.tsx"),
    source("src/app/(mobile)/m/sold/brand/[slug]/page.tsx"),
    source("src/app/(shop)/sold/[id]/page.tsx"),
    source("src/app/sitemap.ts"),
    source("src/app/robots.ts"),
  ]);
  assert.doesNotMatch(shopLayout, /canonical/);
  assert.match(soldPage, /canonical:\s*"\/sold"/);
  assert.match(brandPage, /alternates:\s*\{ canonical: url, media:/);
  assert.match(brandPage, /decodeURIComponent\(value\)/);
  assert.match(mobileBrandPage, /decodeURIComponent\(value\)/);
  assert.match(mobileBrandPage, /fetchSoldBrands\(\)/);
  assert.match(mobileBrandPage, /brand\.brand_slug === slug\)\) notFound\(\)/);
  assert.match(detailPage, /UUID_PATTERN\.test\(id\).*notFound\(\)/s);
  assert.match(detailPage, /"@type":\s*"Product"/);
  assert.match(detailPage, /https:\/\/schema\.org\/SoldOut/);
  assert.match(detailPage, /priceCurrency:\s*"KRW"/);
  assert.match(sitemap, /sold\/brand/);
  assert.match(robots, /sitemap\.xml/);
});

test("sold archive stays addressable but main navigation exposes it only through feed toggles", async () => {
  const [pcHeader, mobileSiteHeader, settings, grid] = await Promise.all([
    source("src/components/layout/PcHeader.tsx"),
    source("src/components/mobile/MobileSiteHeader.tsx"),
    source("src/components/settings/SiteSettingsPage.tsx"),
    source("src/components/features/auction/AuctionFeedGrid.tsx"),
  ]);
  for (const navigation of [pcHeader, mobileSiteHeader, settings]) {
    assert.doesNotMatch(navigation, /판매 완료/);
    assert.doesNotMatch(navigation, /\/sold/);
  }
  assert.match(grid, /판매 완료 상품만 보기/);
  assert.match(grid, /판매 중 상품 보기/);
});

test("sold feed RPC supports both sale types without exposing buyer identity", async () => {
  const [migration, service, route] = await Promise.all([
    source("supabase/migrations/20260724055250_add_sold_product_feed_filter.sql"),
    source("src/services/products.ts"),
    source("src/app/api/products/route.ts"),
  ]);
  assert.match(migration, /get_public_sold_feed_products/);
  assert.match(migration, /products\.sale_type = p_sale_type/);
  assert.match(migration, /commerce_order_items/);
  assert.match(migration, /to anon, authenticated/);
  assert.doesNotMatch(migration, /member_id|bidder_id|winner_display_name/);
  assert.match(service, /fetchSoldFeedProducts/);
  assert.match(route, /searchParams\.get\("view"\) === "sold"/);
});

test("sold archive accepts canonical fixed sales and Owner-recovered auction settlements", async () => {
  const [migration, soldService] = await Promise.all([
    source("supabase/migrations/20260830122932_align_public_auction_expiry_and_sold_archive.sql"),
    source("src/services/sold.ts"),
  ]);
  assert.match(migration, /returns table \([\s\S]*sale_type text/);
  assert.match(migration, /offers\.status = 'settled'/);
  assert.match(migration, /orders\.status = 'confirmed'/);
  assert.match(migration, /inventory\.ownership_status = 'active'/);
  assert.match(migration, /products\.sale_type = 'fixed'/);
  assert.match(soldService, /product\.sale_type !== "auction" \|\| isSoldFeedVisible/);
});

test("auction settlement copy and optional measurement rendering match policy", async () => {
  const [panel, bidRoutePanel, report] = await Promise.all([
    source("src/components/features/auction/detail/StickyBidPanel.tsx"),
    source("src/components/features/auction/detail/AuctionBidRoutePanel.tsx"),
    source("src/components/features/auction/detail/ConditionReport.tsx"),
  ]);
  await assert.rejects(
    source("src/components/features/auction/detail/BidModal.tsx"),
  );
  assert.match(panel, /aria-describedby="auction-settlement-summary"/);
  assert.match(
    panel,
    /낙찰 후 서버가 확정한 결제 마감까지 입금 · 미결제 시 낙찰\s*취소·경고 및 차순위 전환/,
  );
  assert.match(
    bidRoutePanel,
    /미결제 경고가 누적되면 입찰이 제한될 수 있습니다/,
  );
  assert.doesNotMatch(panel, /미등록/);
  assert.doesNotMatch(report, /미등록/);
  assert.match(report, /rows\.length > 0/);
});
