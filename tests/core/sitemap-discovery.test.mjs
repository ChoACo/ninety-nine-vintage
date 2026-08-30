import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);

test("sitemap exposes canonical public catalog routes and isolates data-source failures", async () => {
  const sitemap = await readFile(new URL("src/app/sitemap.ts", rootUrl), "utf8");

  for (const path of ["/home", "/shop", "/feed", "/live", "/centers", "/sold"]) {
    assert.match(sitemap, new RegExp(`SITE_URL\\}${path.replaceAll("/", "\\/")}`));
  }

  assert.match(sitemap, /fetchAllPublishedProducts\(\)/);
  assert.match(sitemap, /fetchActiveStores\(\)/);
  assert.match(sitemap, /\.lte\("publish_at", now\)/);
  assert.match(sitemap, /buildPublicCatalogVisibilityFilter\(now\)/);
  assert.match(sitemap, /visibleSoldBrandSlugs/);
  assert.match(sitemap, /visibleSoldBrands\.map/);
  assert.match(sitemap, /product\.sale_type === "fixed" \? "shop" : "auction"/);
  assert.match(sitemap, /\/centers\/\$\{encodeURIComponent\(store\.slug\)\}/);
  assert.match(sitemap, /Promise\.allSettled/);
  assert.match(sitemap, /export const revalidate = 3_600/);
  assert.match(sitemap, /\.slice\(0, MAX_SITEMAP_ENTRIES\)/);
  assert.doesNotMatch(sitemap, /SITE_URL\}\/m\//);
  assert.doesNotMatch(sitemap, /SITE_URL\}\/admin\//);
});

test("public catalog visibility keeps auctions addressable through their final close", async () => {
  const visibility = await readFile(
    new URL("src/lib/catalog/publicProductVisibility.ts", rootUrl),
    "utf8",
  );
  const migration = await readFile(
    new URL("supabase/migrations/20260830131607_restore_seven_day_no_bid_auction_lifecycle.sql", rootUrl),
    "utf8",
  );

  assert.match(visibility, /auction_feed_expires_at\.gt/);
  assert.match(visibility, /closes_at\.gt/);
  assert.match(migration, /auction_close_at\([\s\S]*new\.publish_at \+ interval '7 days'/);
  assert.match(migration, /status in \('pending', 'active'\)/);
  assert.match(migration, /p_at >= public\.auction_close_at\([\s\S]*interval '7 days'/);
  assert.match(migration, /products\.past_action = 'pending'/);
  assert.match(migration, /not exists \([\s\S]*public\.auction_bids/);
  assert.doesNotMatch(migration, /interval '3 days'/);
});
