import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("keeps originals out of catalog cards and observes images before loading", async () => {
  const [policy, deferredImage, gallery, soldFeed, soldArchive] = await Promise.all([
    source("src/utils/catalogImages.ts"),
    source("src/components/common/DeferredProductImage.tsx"),
    source("src/components/feed/PhotoGallery.tsx"),
    source("src/components/feed/SoldAuctionFeed.tsx"),
    source("src/components/sold/SoldArchivePage.tsx"),
  ]);

  assert.match(policy, /CATALOG_IMAGE_MAX_EDGE = 800/);
  assert.match(policy, /SUPABASE_PUBLIC_RENDER_PATH/);
  assert.match(policy, /searchParams\.set\("width", String\(CATALOG_IMAGE_MAX_EDGE\)\)/);
  assert.match(policy, /rendered\.pathname\.includes\(SUPABASE_PUBLIC_OBJECT_PATH\)/);
  assert.match(policy, /else if \(!rendered\.pathname\.includes\(SUPABASE_PUBLIC_RENDER_PATH\)\)/);
  assert.match(deferredImage, /new IntersectionObserver/);
  assert.match(deferredImage, /rootMargin: "96px 0px"/);
  assert.match(deferredImage, /\{shouldLoad && src && !hasFailed \? \(/);
  assert.match(deferredImage, /loading="lazy"/);
  assert.match(deferredImage, /commerce-skeleton/);
  assert.match(gallery, /getCatalogThumbnailUrl/);
  assert.match(gallery, /const PhotoGalleryModal = lazy/);
  assert.match(gallery, /!compact && thumbnails\.length > 0/);
  assert.doesNotMatch(gallery, /thumbnailImages\?\.\[index\] \|\| image/);
  for (const archive of [soldFeed, soldArchive]) {
    assert.match(archive, /DeferredProductImage/);
    assert.match(archive, /getCatalogThumbnailUrl/);
    assert.doesNotMatch(
      archive,
      /auction\.thumbnailUrls\[0\]\s*\|\|\s*auction\.imageUrls\[0\]/,
    );
  }
});

test("restores deep catalog state and mirrors refinements in the URL", async () => {
  const [hook, feed, filters] = await Promise.all([
    source("src/hooks/useFeedCatalogState.ts"),
    source("src/components/feed/FeedList.tsx"),
    source("src/utils/catalogFilters.ts"),
  ]);

  assert.match(hook, /sessionStorage\.setItem\(STORAGE_KEY/);
  assert.match(hook, /window\.history\.scrollRestoration = "manual"/);
  assert.match(hook, /window\.history\.replaceState/);
  assert.match(hook, /scrollY/);
  assert.match(hook, /anchorViewportTop/);
  assert.match(hook, /findFeedCard/);
  assert.match(hook, /void onLoadMore\(\)/);
  assert.match(hook, /restoreCompleteRef\.current = true/);
  assert.doesNotMatch(hook, /querySelector<HTMLElement>\(`\[data-feed-product-id=/);
  assert.match(feed, /Catalog search/);
  assert.match(feed, /마감 임박순/);
  assert.match(feed, /현재가 높은순/);
  assert.match(feed, /\["all", "S", "M", "L", "XL"\]/);
  assert.match(feed, /createPortal\(/);
  assert.match(filters, /sortCatalogPosts/);
  assert.match(filters, /matchesCatalogSize/);
  assert.match(filters, /matchesCatalogSearch/);
});

test("splits the brand home from the full catalog and gates destructive tools", async () => {
  const [homeRoute, feedRoute, home, app, card, modal, products] = await Promise.all([
    source("app/page.tsx"),
    source("app/feed/page.tsx"),
    source("src/components/home/HomeLanding.tsx"),
    source("src/components/AuctionApp.tsx"),
    source("src/components/feed/PostCard.tsx"),
    source("src/components/feed/FeedProductControlModal.tsx"),
    source("src/lib/supabase/products.ts"),
  ]);

  assert.match(homeRoute, /page="home"/);
  assert.match(feedRoute, /page="feed"/);
  assert.match(home, /마감 임박 Top 4/);
  assert.match(home, /오늘의 추천 빈티지/);
  assert.match(home, /href="\/feed"/);
  assert.match(app, /showOperatorControls=\{canAccessOperationsCenter\(auth\.role\)\}/);
  assert.match(app, /deleteManagedProduct\(post\.id, post\.updatedAt\)/);
  assert.match(app, /setPosts\(\(current\) => current\.filter/);
  assert.match(card, /role="toolbar"/);
  assert.match(card, /onRequestProductControl\(post, "pause"\)/);
  assert.match(card, /onRequestProductControl\(post, "delete"\)/);
  assert.match(modal, /서버에서 잠겨/);
  assert.match(modal, /<Modal/);
  assert.match(products, /updatedAt: row\.updated_at/);
});

test("preserves loaded catalog depth during realtime refresh", async () => {
  const hook = await source("src/hooks/useSupabaseProducts.ts");

  assert.match(hook, /const requestedPageCount = Math\.max\(nextPageRef\.current, 1\)/);
  assert.match(hook, /for \(let page = 0; page < requestedPageCount; page \+= 1\)/);
  assert.match(hook, /const refreshedPosts = refreshedPages\.flatMap/);
  assert.match(hook, /setPosts\(uniquePosts\)/);
  assert.match(hook, /REALTIME_REFETCH_DEBOUNCE_MS = 160/);
});
