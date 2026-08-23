import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("tablet navigation swaps the bottom capsule for a fixed side rail at lg", async () => {
  const [layout, bottomNav, sideRail, chat] = await Promise.all([
    source("src/components/mobile/MobileSiteLayout.tsx"),
    source("src/components/mobile/MobileSiteBottomNav.tsx"),
    source("src/components/layout/SideNavRail.tsx"),
    source("src/components/features/chat/FloatingChat.tsx"),
  ]);
  assert.match(bottomNav, /lg:hidden/);
  assert.match(sideRail, /fixed inset-y-0 left-0 z-40 hidden w-20[\s\S]*lg:flex/);
  assert.match(layout, /<SideNavRail \/>/);
  assert.match(layout, /lg:pl-24 lg:pr-6/);
  assert.match(chat, /lg:bottom-8 lg:right-8/);
});

test("tablet product cards expose fine-pointer quick measurements", async () => {
  const [card, feedCard, css, payload] = await Promise.all([
    source("src/components/features/auction/AuctionCard.tsx"),
    source("src/components/features/auction/AuctionFeedCard.tsx"),
    source("src/app/globals.css"),
    source("src/lib/catalog/fixedProductPayload.ts"),
  ]);
  for (const content of [card, feedCard]) {
    assert.match(content, /product-card/);
    assert.match(content, /product-quick-specs/);
    assert.match(content, /measurementEntries\(item\.measurements\)/);
  }
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(css, /\.product-card:hover \.product-quick-specs/);
  assert.match(payload, /measurements: product\.measurements/);
});

test("tablet hero, PDP, cart and workspaces use balanced split panes", async () => {
  const [home, showcase, detail, panel, cart, workspace] = await Promise.all([
    source("src/app/(mobile)/m/home/page.tsx"),
    source("src/components/features/home/HomeFeaturedAuction.tsx"),
    source("src/components/features/auction/detail/AuctionDetailView.tsx"),
    source("src/components/features/auction/detail/StickyBidPanel.tsx"),
    source("src/components/features/commerce/CartView.tsx"),
    source("src/components/admin/AdminWorkspaceShell.tsx"),
  ]);
  assert.match(home, /lg:w-\[45%\]/);
  assert.match(showcase, /lg:w-\[55%\]/);
  assert.match(showcase, /tablet-hero-media/);
  assert.match(detail, /sm:col-span-6 md:col-span-7/);
  assert.match(panel, /sm:col-span-6 md:col-span-5/);
  assert.match(cart, /md:grid-cols-5/);
  assert.match(cart, /sm:col-span-7 md:col-span-3/);
  assert.match(cart, /sm:col-span-5 md:col-span-2 md:top-24/);
  assert.match(workspace, /md:grid-cols-\[256px_minmax\(0,1fr\)\]/);
  assert.match(workspace, /md:w-64 md:shrink-0 md:border-r/);
  assert.match(workspace, /md:p-6 md:pb-8/);
});
