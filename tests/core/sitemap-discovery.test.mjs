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
  assert.match(sitemap, /\.eq\("status", "active"\)/);
  assert.match(sitemap, /\.lte\("publish_at", now\)/);
  assert.match(sitemap, /auction_feed_expires_at\.gt/);
  assert.match(sitemap, /product\.sale_type === "fixed" \? "shop" : "auction"/);
  assert.match(sitemap, /\/centers\/\$\{encodeURIComponent\(store\.slug\)\}/);
  assert.match(sitemap, /Promise\.allSettled/);
  assert.match(sitemap, /export const revalidate = 3_600/);
  assert.match(sitemap, /\.slice\(0, MAX_SITEMAP_ENTRIES\)/);
  assert.doesNotMatch(sitemap, /SITE_URL\}\/m\//);
  assert.doesNotMatch(sitemap, /SITE_URL\}\/admin\//);
});
