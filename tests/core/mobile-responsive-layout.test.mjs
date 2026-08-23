import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("mobile shell reserves bottom navigation space and honors safe areas", async () => {
  const [rootLayout, mobileLayout, bottomNav] = await Promise.all([
    source("src/app/layout.tsx"),
    source("src/components/mobile/MobileSiteLayout.tsx"),
    source("src/components/mobile/MobileSiteBottomNav.tsx"),
  ]);
  assert.doesNotMatch(rootLayout, /<body className="[^"]*overflow-x-hidden/);
  assert.match(mobileLayout, /min-h-screen overflow-x-hidden/);
  assert.match(mobileLayout, /pb-32/);
  assert.match(bottomNav, /safe-area-inset-bottom/);
  assert.match(bottomNav, /max-w-lg/);
  assert.match(bottomNav, /rounded-full/);
  assert.match(bottomNav, /min-h-\[44px\] min-w-\[44px\]/);
});

test("footer stacks without clipping business information", async () => {
  const footer = await source("src/components/layout/PcFooter.tsx");
  assert.match(footer, /flex w-full min-w-0 max-w-full flex-col gap-6 overflow-hidden md:grid/);
  assert.match(footer, /break-keep break-words text-xs leading-relaxed text-muted/);
});

test("catalog cards use a mobile portrait ratio and stable one-line titles", async () => {
  const [card, liveCard, soldCard] = await Promise.all([
    source("src/components/features/auction/AuctionCard.tsx"),
    source("src/components/features/auction/AuctionFeedCard.tsx"),
    source("src/components/features/auction/SoldFeedCard.tsx"),
  ]);
  for (const component of [card, liveCard, soldCard]) {
    assert.match(component, /aspect-\[3\/4\] w-full/);
    assert.match(component, /min-h-\[1\.5rem\]/);
    assert.match(component, /line-clamp-1[^\n]*text-sm font-medium/);
  }
});

test("mobile store detail has a centered sticky header and compact banner", async () => {
  const [tabs, experience] = await Promise.all([
    source("src/components/features/catalog/StoreMallTabs.tsx"),
    source("src/components/features/catalog/StoreMallExperience.tsx"),
  ]);
  assert.match(tabs, /sticky top-\[var\(--mobile-sticky-header-offset,3\.5rem\)\]/);
  assert.match(tabs, /grid-cols-\[44px_minmax\(0,1fr\)_44px\]/);
  assert.match(tabs, /router\.back\(\)/);
  assert.match(tabs, /text-center text-sm font-black/);
  assert.match(experience, /h-32 w-full rounded-xl sm:h-48/);
});

test("mobile cart exposes an expandable payment bar and full-card shipping choices", async () => {
  const cart = await source("src/components/features/commerce/CartView.tsx");
  assert.match(cart, /aria-label="모바일 결제 요약"/);
  assert.match(cart, /mobileSummaryExpanded/);
  assert.match(cart, /총 \{products\.length\}개 · 결제 예정 금액/);
  assert.match(cart, />결제하기<\/button>/);
  assert.match(cart, /cursor-pointer rounded-xl border p-3 text-xs/);
  assert.match(cart, /charge\.unitName\} 배송비/);
});

test("mobile form controls keep the iOS-safe sixteen pixel font size", async () => {
  const css = await source("src/app/globals.css");
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*font-size: 1rem !important/);
});
