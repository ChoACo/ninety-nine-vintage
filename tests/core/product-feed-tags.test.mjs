import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  extractExplicitProductYear,
  getProductFeedTags,
} from "../../src/lib/catalog/productFeedTags.ts";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("product feed tags present size, gender, and an explicit description year", () => {
  assert.deepEqual(
    getProductFeedTags(
      {
        description: "1998년식 아카이브 재킷",
        gender: "공용",
        size: "L",
      },
      2026,
    ),
    [
      { kind: "size", label: "L" },
      { kind: "gender", label: "공용" },
      { kind: "year", label: "1998년" },
    ],
  );
  assert.equal(
    extractExplicitProductYear("2012 컬렉션 제품", 2026),
    2012,
  );
});

test("product feed year tags do not guess vague, embedded, or future years", () => {
  assert.equal(extractExplicitProductYear("90년대 빈티지 제품", 2026), null);
  assert.equal(extractExplicitProductYear("모델 A2020B", 2026), null);
  assert.equal(extractExplicitProductYear("사이즈 20240mm", 2026), null);
  assert.equal(extractExplicitProductYear("2099년식", 2026), null);
  assert.deepEqual(
    getProductFeedTags({ description: "", gender: "", size: "  " }, 2026),
    [],
  );
});

test("active fixed and auction feed cards render the shared compact tag row", async () => {
  const [fixedCard, auctionCard, feed, rail, tags] = await Promise.all([
    source("src/components/features/auction/AuctionCard.tsx"),
    source("src/components/features/auction/AuctionFeedCard.tsx"),
    source("src/components/features/auction/AuctionFeedGrid.tsx"),
    source("src/components/features/catalog/ProductRail.tsx"),
    source("src/components/features/catalog/ProductFeedTags.tsx"),
  ]);

  for (const card of [fixedCard, auctionCard]) {
    assert.match(
      card,
      /<ProductFeedTags description=\{item\.description\} gender=\{item\.gender\} hashtags=\{item\.hashtags\} size=\{item\.size\} \/>/,
    );
  }
  assert.match(feed, /gender: product\.gender/);
  assert.match(rail, /gender: product\.gender/);
  assert.match(rail, /description=\{product\.description\}[\s\S]*?gender=\{product\.gender\}[\s\S]*?size=\{product\.sizeLabel\}/);
  assert.match(tags, /aria-label="상품 요약 태그"/);
  assert.match(tags, /text-\[9px\]/);
});
