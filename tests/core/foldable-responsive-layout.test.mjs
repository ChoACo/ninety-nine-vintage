import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("foldable product grids promote from two to three columns at sm", async () => {
  const files = await Promise.all([
    source("src/components/features/catalog/ProductRail.tsx"),
    source("src/components/features/auction/AuctionFeedGrid.tsx"),
    source("src/components/features/auction/AuctionInactiveTeaser.tsx"),
    source("src/components/features/home/HomeSkeletons.tsx"),
    source("src/components/skeletons/ShopSkeletons.tsx"),
    source("src/components/skeletons/AuctionSkeletons.tsx"),
  ]);
  for (const content of files) {
    assert.match(content, /grid-cols-2 gap-4[\s\S]{0,80}sm:grid-cols-3[\s\S]{0,80}md:grid-cols-3 md:gap-6[\s\S]{0,80}lg:grid-cols-4/);
  }
});

test("foldable hero uses a horizontal half-and-half showcase", async () => {
  const [home, mobileHome, showcase] = await Promise.all([
    source("src/app/(shop)/home/page.tsx"),
    source("src/app/(mobile)/m/home/page.tsx"),
    source("src/components/features/home/HomeFeaturedAuction.tsx"),
  ]);
  assert.match(home, /flex min-h-0 flex-col[\s\S]*sm:flex-row/);
  assert.match(mobileHome, /flex flex-col[\s\S]*sm:flex-row/);
  assert.match(mobileHome, /sm:w-1\/2/);
  assert.match(mobileHome, /rounded-3xl sm:p-10/);
  assert.match(mobileHome, /bg-gradient-to-br from-card to-muted\/40/);
  assert.match(home, /rounded-3xl border border-line\/40 bg-gradient-to-br from-card to-muted\/40/);
  assert.match(showcase, /sm:aspect-\[4\/3\]/);
  assert.match(showcase, /sm:w-1\/2/);
});

test("foldable navigation, cart and PDP use centered and split layouts", async () => {
  const [layout, nav, chat, cart, detail, panel, css] = await Promise.all([
    source("src/components/mobile/MobileSiteLayout.tsx"),
    source("src/components/mobile/MobileSiteBottomNav.tsx"),
    source("src/components/features/chat/FloatingChat.tsx"),
    source("src/components/features/commerce/CartView.tsx"),
    source("src/components/features/auction/detail/AuctionDetailView.tsx"),
    source("src/components/features/auction/detail/StickyBidPanel.tsx"),
    source("src/app/globals.css"),
  ]);
  assert.match(layout, /sm:max-w-3xl/);
  assert.match(layout, /pb-\[calc\(7rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(nav, /bottom-0[\s\S]*safe-area-inset-bottom[\s\S]*max-w-lg/);
  assert.match(chat, /sm:bottom-24 sm:right-6/);
  assert.match(cart, /max-w-\[1400px\][\s\S]*sm:grid-cols-12 sm:gap-8/);
  assert.match(cart, /sm:col-span-7/);
  assert.match(cart, /sm:col-span-5/);
  assert.match(cart, /sticky top-20/);
  assert.match(detail, /sm:grid-cols-12/);
  assert.match(detail, /max-w-\[1400px\]/);
  assert.match(detail, /sm:col-span-6/);
  assert.match(panel, /sm:sticky sm:col-span-6/);
  assert.match(css, /@media \(max-width: 639px\)[\s\S]*mobile-detail-cta/);
});

test("foldable workspace uses an off-canvas drawer before md", async () => {
  const workspace = await source("src/components/admin/AdminWorkspaceShell.tsx");
  assert.match(workspace, /--workspace-sidebar-offset/);
  assert.match(workspace, /mobileOpen \? "0%" : "-100%"/);
  assert.match(workspace, /fixed inset-0 z-\[80\] bg-black\/60 md:hidden/);
  assert.match(workspace, /md:sticky md:top-0/);
  assert.match(workspace, /md:grid-cols-\[var\(--workspace-sidebar-width\)_minmax\(0,1fr\)\]/);
});
