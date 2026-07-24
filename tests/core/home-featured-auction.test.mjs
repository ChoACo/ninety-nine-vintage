import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  selectFeaturedAuctionCandidates,
  shuffleFeaturedAuctionCandidates,
} from "../../src/components/features/home/featuredAuction.ts";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

function product(overrides) {
  return {
    bidHistory: [],
    brand: "브랜드",
    currentPrice: 10_000,
    id: crypto.randomUUID(),
    imageUrls: ["/product.jpg"],
    participantCount: 0,
    status: "active",
    title: "상품",
    ...overrides,
  };
}

test("home candidates combine highest price, latest bid, and most bids without duplicates", () => {
  const highest = product({ id: "highest", currentPrice: 90_000 });
  const latest = product({
    bidHistory: [
      { amount: 20_000, bidAt: "2026-07-24T05:00:00Z", outcome: "active" },
    ],
    id: "latest",
  });
  const most = product({
    bidHistory: [
      { amount: 11_000, bidAt: "2026-07-24T01:00:00Z", outcome: "active" },
      { amount: 12_000, bidAt: "2026-07-24T02:00:00Z", outcome: "active" },
      { amount: 13_000, bidAt: "2026-07-24T03:00:00Z", outcome: "active" },
    ],
    id: "most",
  });
  const inactive = product({
    currentPrice: 1_000_000,
    id: "inactive",
    status: "closed",
  });

  assert.deepEqual(
    selectFeaturedAuctionCandidates([most, inactive, latest, highest]).map(
      (candidate) => candidate.id,
    ),
    ["highest", "latest", "most"],
  );
  assert.deepEqual(
    shuffleFeaturedAuctionCandidates([highest, latest, most], () => 0).map(
      (candidate) => candidate.id,
    ),
    ["latest", "most", "highest"],
  );
});

test("home hero rotates auction product main images every five seconds and keeps a fallback banner", async () => {
  const [home, mobileHome, hero] = await Promise.all([
    source("src/app/(shop)/home/page.tsx"),
    source("src/app/(mobile)/m/home/page.tsx"),
    source("src/components/features/home/HomeFeaturedAuction.tsx"),
  ]);
  assert.match(home, /limit: 100, saleType: "auction", sort: "latest"/);
  assert.match(home, /selectFeaturedAuctionCandidates\(auctions\)/);
  assert.match(home, /imageUrl: product\.imageUrls\[0\]/);
  assert.doesNotMatch(home, /fixed\[0\]/);
  assert.match(hero, /window\.setInterval/);
  assert.match(hero, /5_000/);
  assert.match(hero, /Math\.random/);
  assert.match(hero, /transition-opacity duration-700/);
  assert.match(hero, /실시간 경매 하러 가기/);
  assert.match(hero, /\/banners\/brand-banner-wide\.png/);
  assert.match(hero, /\/banners\/brand-banner-mobile\.jpg/);
  assert.match(hero, /href=\{`\$\{basePath\}\/feed`\}/);
  assert.match(hero, /href=\{`\$\{basePath\}\/auction\/\$\{product\.id\}`\}/);
  assert.match(mobileHome, /limit: 100, saleType: "auction", sort: "latest"/);
  assert.match(mobileHome, /selectFeaturedAuctionCandidates\(auctions\)/);
  assert.match(mobileHome, /basePath="\/m"/);
  assert.match(mobileHome, /surface="mobile"/);
  assert.doesNotMatch(mobileHome, /CatalogImage/);
});
