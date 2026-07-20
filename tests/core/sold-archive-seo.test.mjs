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

test("single and bulk product writes require and explicitly persist brand", async () => {
  const routes = await Promise.all([
    source("src/app/api/admin/operator/products/route.ts"),
    source("src/app/api/admin/operator/products/bulk/route.ts"),
    source("src/app/api/admin/owner/products/route.ts"),
    source("src/app/api/admin/owner/products/bulk/route.ts"),
  ]);
  for (const route of routes) {
    assert.match(route, /normalizeProductBrand\(body\??\.brand\)/);
    assert.match(route, /brand_source:\s*"explicit"/);
  }
  const updates = await Promise.all([
    source("src/app/api/admin/operator/products/[id]/route.ts"),
    source("src/app/api/admin/owner/products/[id]/route.ts"),
  ]);
  for (const route of updates) {
    assert.match(route, /brand_slug\s*=/);
    assert.match(route, /brand_source\s*=\s*"explicit"/);
  }
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
  const [shopLayout, soldPage, brandPage, detailPage, sitemap, robots] = await Promise.all([
    source("src/app/(shop)/layout.tsx"),
    source("src/app/(shop)/sold/page.tsx"),
    source("src/app/(shop)/sold/brand/[slug]/page.tsx"),
    source("src/app/(shop)/sold/[id]/page.tsx"),
    source("src/app/sitemap.ts"),
    source("src/app/robots.ts"),
  ]);
  assert.doesNotMatch(shopLayout, /canonical/);
  assert.match(soldPage, /canonical:\s*"\/sold"/);
  assert.match(brandPage, /alternates:\s*\{ canonical: url \}/);
  assert.match(brandPage, /decodeURIComponent\(value\)/);
  assert.match(detailPage, /UUID_PATTERN\.test\(id\).*notFound\(\)/s);
  assert.match(detailPage, /"@type":\s*"Product"/);
  assert.match(detailPage, /https:\/\/schema\.org\/SoldOut/);
  assert.match(detailPage, /priceCurrency:\s*"KRW"/);
  assert.match(sitemap, /sold\/brand/);
  assert.match(robots, /sitemap\.xml/);
});

test("auction settlement copy and optional measurement rendering match policy", async () => {
  const [panel, modal, report] = await Promise.all([
    source("src/components/features/auction/detail/StickyBidPanel.tsx"),
    source("src/components/features/auction/detail/BidModal.tsx"),
    source("src/components/features/auction/detail/ConditionReport.tsx"),
  ]);
  assert.match(panel, /aria-describedby="auction-settlement-summary"/);
  assert.match(panel, /낙찰 후 다음 날 11:59까지 결제 · 미결제 시 낙찰 취소·경고 및 차순위 전환/);
  assert.match(modal, /미결제 경고가 누적되면 입찰이 제한될 수 있습니다/);
  assert.doesNotMatch(panel, /미등록/);
  assert.doesNotMatch(report, /미등록/);
  assert.match(report, /rows\.length > 0/);
});
