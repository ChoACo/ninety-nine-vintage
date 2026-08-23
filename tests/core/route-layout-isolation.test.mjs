import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("desktop and mobile route groups render mutually exclusive shells", async () => {
  const [desktopRouteLayout, mobileRouteLayout, desktopShell, mobileShell] =
    await Promise.all([
      source("src/app/(shop)/layout.tsx"),
      source("src/app/(mobile)/m/layout.tsx"),
      source("src/components/layout/PcLayout.tsx"),
      source("src/components/mobile/MobileSiteLayout.tsx"),
    ]);

  assert.match(desktopRouteLayout, /<PcLayout>\{children\}\{modal\}<\/PcLayout>/);
  assert.doesNotMatch(desktopRouteLayout, /MobileSiteLayout|MobileSiteBottomNav/);
  assert.match(mobileRouteLayout, /<MobileSiteLayout>\{children\}<\/MobileSiteLayout>/);
  assert.doesNotMatch(mobileRouteLayout, /PcLayout|PcHeader|PcFooter/);

  assert.match(desktopShell, /data-ui-surface="desktop"/);
  assert.match(desktopShell, /min-w-\[768px\]/);
  assert.match(desktopShell, /<PcHeader \/>/);
  assert.doesNotMatch(desktopShell, /MobileSiteHeader|MobileSiteBottomNav/);

  assert.match(mobileShell, /data-ui-surface="mobile"/);
  assert.match(mobileShell, /<MobileSiteHeader \/>/);
  assert.match(mobileShell, /<MobileSiteBottomNav \/>/);
  assert.doesNotMatch(mobileShell, /PcHeader|PcFooter/);
});

test("desktop remains a compact PC surface at split-screen width", async () => {
  const [rootLayout, globalCss, header, productRail, centerGrid, storeGrid, auctionGrid] =
    await Promise.all([
      source("src/app/layout.tsx"),
      source("src/app/globals.css"),
      source("src/components/layout/PcHeader.tsx"),
      source("src/components/features/catalog/ProductRail.tsx"),
      source("src/components/features/catalog/CenterMallHub.tsx"),
      source("src/components/features/catalog/StoreMallGrid.tsx"),
      source("src/components/features/auction/AuctionFeedGrid.tsx"),
    ]);

  assert.doesNotMatch(rootLayout, /<body className="[^"]*overflow-x-hidden/);
  assert.match(globalCss, /html \{[\s\S]*?overflow-x: auto/);
  assert.match(globalCss, /body \{[\s\S]*?overflow-x: visible/);
  assert.match(header, /min-\[1100px\]:inline/);
  assert.match(header, /min-\[900px\]:flex lg:w-36 xl:w-44/);
  assert.doesNotMatch(header, /MobileSiteHeader|hamburger/i);

  for (const grid of [productRail, centerGrid, storeGrid]) {
    assert.match(
      grid,
      /grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5/,
    );
  }
  assert.match(
    auctionGrid,
    /grid grid-cols-2 gap-3[\s\S]{0,100}md:grid-cols-4[\s\S]{0,100}xl:grid-cols-5 2xl:grid-cols-6/,
  );
});
