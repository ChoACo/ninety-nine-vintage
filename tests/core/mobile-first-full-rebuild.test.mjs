import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("floating chat clears navigation and sticky commerce actions", async () => {
  const chat = await source("src/components/features/chat/FloatingChat.tsx");
  assert.match(chat, /z-40/);
  assert.match(chat, /bottom-\[calc\(6\.5rem\+env\(safe-area-inset-bottom,16px\)\)\]/);
  assert.match(chat, /bottom-\[calc\(11\.5rem\+env\(safe-area-inset-bottom,16px\)\)\]/);
  assert.match(chat, /size-12/);
});

test("mobile header auto-hides on downward scroll and restores sticky offsets", async () => {
  const [hook, header, layout, css] = await Promise.all([
    source("src/hooks/useScrollDirection.ts"),
    source("src/components/mobile/MobileAutoHideHeader.tsx"),
    source("src/components/mobile/MobileSiteLayout.tsx"),
    source("src/app/globals.css"),
  ]);
  assert.match(hook, /window\.addEventListener\("scroll", onScroll, \{ passive: true \}\)/);
  assert.match(hook, /requestAnimationFrame/);
  assert.match(header, /direction === "down" && scrollY >= 50/);
  assert.match(header, /pointer-events-none -translate-y-full opacity-0/);
  assert.match(header, /transition-all duration-300 ease-in-out/);
  assert.match(layout, /<MobileAutoHideHeader>/);
  assert.match(css, /data-mobile-header-hidden="true"[\s\S]*--mobile-sticky-header-offset: 0rem/);
});

test("catalog cards use a compact portrait hierarchy with floating grade and live chips", async () => {
  const cards = await Promise.all([
    source("src/components/features/auction/AuctionCard.tsx"),
    source("src/components/features/auction/AuctionFeedCard.tsx"),
  ]);
  for (const card of cards) {
    assert.match(card, /aspect-\[3\/4\] w-full overflow-hidden rounded-xl border border-line\/30/);
    assert.match(card, /left-2 top-2/);
    assert.match(card, /GRADE \{grade\}/);
    assert.match(card, /LIVE/);
    assert.match(card, /line-clamp-1 break-keep text-xs font-medium text-foreground\/90[^"]*sm:text-sm/);
    assert.match(card, /text-sm font-bold text-foreground/);
  }
});

test("mobile cart and PDP actions float above the capsule navigation", async () => {
  const [nav, cart, panel, css] = await Promise.all([
    source("src/components/mobile/MobileSiteBottomNav.tsx"),
    source("src/components/features/commerce/CartView.tsx"),
    source("src/components/features/auction/detail/StickyBidPanel.tsx"),
    source("src/app/globals.css"),
  ]);
  assert.match(nav, /bottom-4[\s\S]*rounded-full[\s\S]*backdrop-blur-xl/);
  assert.match(cart, /bottom-\[calc\(6\.5rem\+env\(safe-area-inset-bottom,16px\)\)\]/);
  assert.match(cart, /aria-expanded=\{mobileSummaryExpanded\}/);
  assert.match(panel, /grid-cols-\[44px_minmax\(0,1fr\)_minmax\(0,1fr\)\]/);
  assert.match(panel, /aria-pressed=\{liked\}/);
  assert.match(panel, /장바구니 담기/);
  assert.match(panel, /즉시 소장하기/);
  assert.match(css, /bottom: calc\(6\.5rem \+ env\(safe-area-inset-bottom, 12px\)\)/);
});
