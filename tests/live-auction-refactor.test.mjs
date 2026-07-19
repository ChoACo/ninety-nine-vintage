import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("LIVE AUCTION exposes date, brand, size, category, gender, and numbered paging", async () => {
  const [feed, filters] = await Promise.all([
    source("src/components/feed/FeedList.tsx"),
    source("src/utils/catalogFilters.ts"),
  ]);

  assert.match(feed, /DateFilterChips/);
  assert.match(feed, /selectedBrand/);
  assert.match(feed, /selectedCategory/);
  assert.match(feed, /selectedGender/);
  assert.match(feed, /aria-label="경매 상품 페이지 이동"/);
  assert.match(feed, /PAGE_SIZE = 24/);
  assert.match(filters, /getCatalogBrand/);
  assert.match(filters, /getCatalogCategory/);
  assert.match(filters, /getCatalogGender/);
});

test("feed product cards route detail through the dedicated auction page", async () => {
  const [card, detail] = await Promise.all([
    source("src/components/feed/PostCard.tsx"),
    source("src/components/features/auction/EditorialAuctionDetail.tsx"),
  ]);

  assert.match(card, /href=\{`\/auction\/\$\{encodeURIComponent\(post\.id\)\}`\}/);
  assert.doesNotMatch(card, /<ProductDetailModal/);
  assert.match(detail, /router\.back\(\)/);
  assert.match(detail, /이전 화면/);
});

test("feed gallery keeps product photos clear of status overlays", async () => {
  const [gallery, card] = await Promise.all([
    source("src/components/feed/PhotoGallery.tsx"),
    source("src/components/feed/PostCard.tsx"),
  ]);

  assert.doesNotMatch(gallery, /사진 \{cleanImages\.length\}장/);
  assert.doesNotMatch(gallery, /추가 사진/);
  assert.match(card, /LIVE BID/);
  assert.match(card, /border-b border-\[var\(--border\)\]/);
});
