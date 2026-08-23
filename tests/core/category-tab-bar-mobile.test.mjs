import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("the shared category bar keeps mobile tabs visible and exposes an accessible sheet", async () => {
  const bar = await source("src/components/common/CategoryTabBar.tsx");

  assert.match(bar, /overflow-x-auto/);
  assert.match(bar, /scrollbar-hide/);
  assert.match(bar, /gap-2/);
  assert.match(bar, /pr-12/);
  assert.match(bar, /selectedTabRef\.current\?\.scrollIntoView\(\{/);
  assert.match(bar, /behavior: "smooth"/);
  assert.match(bar, /inline: "center"/);
  assert.match(bar, /block: "nearest"/);
  assert.match(bar, /aria-label="전체 카테고리 보기"/);
  assert.match(bar, /bg-gradient-to-l from-background via-background\/90 to-transparent/);
  assert.match(bar, /placement="sheet-bottom"/);
  assert.match(bar, /카테고리 전체보기/);
  assert.match(bar, /grid-cols-3[\s\S]*sm:grid-cols-4/);
  assert.match(bar, /setSheetOpen\(false\)/);
  assert.match(bar, /min-h-11 min-w-11/);
});

test("center mall and archive shop use the same hybrid category bar without replacing their filter contracts", async () => {
  const [centerMall, categoryChips, archiveHeader, feed] = await Promise.all([
    source("src/components/features/catalog/CenterMallHub.tsx"),
    source("src/components/features/shop/CategoryChips.tsx"),
    source("src/components/features/shop/ArchiveShopHeader.tsx"),
    source("src/components/features/auction/AuctionFeedGrid.tsx"),
  ]);

  assert.match(centerMall, /<CategoryTabBar/);
  assert.match(centerMall, /onValueChange=\{setFilter\}/);
  assert.match(centerMall, /value=\{filter\}/);
  assert.match(categoryChips, /<CategoryTabBar/);
  assert.match(categoryChips, /\?category=\$\{encodeURIComponent\(value\)\}/);
  assert.match(archiveHeader, /<CategoryChips activeCategory=\{category\}/);
  assert.match(feed, /const routeCategory = routeSearchParams\.get\("category"\) \?\? ""/);
  assert.match(feed, /!routeCategory \|\| card\.category\.includes\(routeCategory\)/);
});
