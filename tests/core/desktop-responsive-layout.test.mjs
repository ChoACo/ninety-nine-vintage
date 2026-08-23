import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("center mall cards expose one full-area link and a separate follow control", async () => {
  const centerMall = await source(
    "src/components/features/catalog/CenterMallHub.tsx",
  );
  assert.match(centerMall, /aria-label=\{`\$\{card\.name\} 센터 방문하기`\}/);
  assert.match(centerMall, /className="absolute inset-0 z-10 rounded-2xl/);
  assert.match(centerMall, /hover:-translate-y-1 hover:border-amber-500\/50 hover:shadow-xl/);
  assert.match(centerMall, /relative z-20 grid size-11/);
  assert.match(centerMall, /mt-auto flex min-h-11[\s\S]*센터 방문하기/);
});

test("desktop product imagery reserves a portrait box and uses Next Image fill when safe", async () => {
  const [card, feedCard, image] = await Promise.all([
    source("src/components/features/auction/AuctionCard.tsx"),
    source("src/components/features/auction/AuctionFeedCard.tsx"),
    source("src/components/ui/CatalogImage.tsx"),
  ]);
  for (const content of [card, feedCard]) {
    assert.match(content, /relative aspect-\[3\/4\]/);
    assert.match(content, /<CatalogImage[\s\S]{0,300}\bfill\b/);
    assert.match(content, /\(max-width: 639px\) 50vw, \(max-width: 767px\) 33vw, \(max-width: 1279px\) 25vw, \(max-width: 1535px\) 20vw, 16vw/);
    assert.match(content, /group-hover:scale-105/);
  }
  assert.match(image, /const fillsContainer = props\.fill === true/);
  assert.match(image, /height=\{fillsContainer \? undefined/);
  assert.match(image, /width=\{fillsContainer \? undefined/);
});

test("desktop shop and auction feeds use bounded five-to-six column cards", async () => {
  const [grid, card, feedCard, shopSkeleton, auctionSkeleton] = await Promise.all([
    source("src/components/features/auction/AuctionFeedGrid.tsx"),
    source("src/components/features/auction/AuctionCard.tsx"),
    source("src/components/features/auction/AuctionFeedCard.tsx"),
    source("src/components/skeletons/ShopSkeletons.tsx"),
    source("src/components/skeletons/AuctionSkeletons.tsx"),
  ]);
  for (const content of [grid, shopSkeleton, auctionSkeleton]) {
    assert.match(content, /md:grid-cols-4[\s\S]{0,80}xl:grid-cols-5 2xl:grid-cols-6/);
  }
  for (const content of [card, feedCard]) {
    assert.match(content, /max-w-\[260px\]/);
    assert.match(content, /aspect-\[3\/4\][\s\S]{0,80}rounded-xl/);
  }
  assert.match(feedCard, /absolute bottom-2 left-2 right-2[\s\S]*bg-black\/70/);
  assert.match(feedCard, /\{bidCount\}건 입찰/);
  assert.match(feedCard, /h-11[\s\S]*sm:h-8/);
});

test("desktop PDP and cart use bounded editorial master-detail ratios", async () => {
  const [layout, detail, gallery, panel, cart] = await Promise.all([
    source("src/components/layout/PcLayout.tsx"),
    source("src/components/features/auction/detail/AuctionDetailView.tsx"),
    source("src/components/features/auction/detail/ItemGallery.tsx"),
    source("src/components/features/auction/detail/StickyBidPanel.tsx"),
    source("src/components/features/commerce/CartView.tsx"),
  ]);
  assert.match(layout, /max-w-\[1400px\]/);
  assert.match(detail, /max-w-\[1400px\]/);
  assert.match(detail, /lg:grid-cols-\[minmax\(0,58fr\)_minmax\(340px,42fr\)\]/);
  assert.match(gallery, /lg:grid-cols-2 lg:gap-4/);
  assert.match(gallery, /lg:aspect-\[3\/4\]/);
  assert.match(panel, /md:top-24/);
  assert.match(panel, /lg:col-auto/);
  assert.match(cart, /lg:grid-cols-\[minmax\(0,65fr\)_minmax\(320px,35fr\)\]/);
  assert.match(cart, /md:top-24 lg:col-auto/);
  assert.match(cart, /deriveCartPricing/);
});

test("desktop global search supports slash without stealing editable input keys", async () => {
  const header = await source("src/components/layout/PcHeader.tsx");
  assert.match(header, /event\.key === "\/"/);
  assert.match(header, /target\.isContentEditable/);
  assert.match(header, /target\.tagName === "INPUT"/);
  assert.match(header, /searchRef\.current\?\.focus\(\)/);
  assert.match(header, /id="global-product-search" name="q"/);
  assert.match(header, /aria-keyshortcuts="\/ Meta\+K Control\+K"/);
  assert.match(header, /<kbd[\s\S]*>\[\/\]<\/kbd>/);
});

test("desktop header keeps authenticated controls inside split-screen widths", async () => {
  const header = await source("src/components/layout/PcHeader.tsx");
  assert.match(header, /<span className="hidden min-\[1100px\]:inline">\{item\.label\}<\/span>/);
  assert.match(header, /min-\[900px\]:flex/);
});
