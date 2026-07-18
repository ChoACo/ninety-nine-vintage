import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("keeps the application shell usable from 320px phones through tablets", async () => {
  const [globals, layout, header, navigation, themeToggle, themeStyles] =
    await Promise.all([
      source("app/globals.css"),
      source("app/layout.tsx"),
      source("src/components/common/SiteHeader.tsx"),
      source("src/components/common/Navigation.tsx"),
      source("src/components/common/ThemeToggle.tsx"),
      source("src/components/common/ThemeToggle.module.css"),
    ]);

  assert.match(globals, /@media \(max-width: 340px\)/);
  assert.match(globals, /@media \(max-width: 767px\)/);
  assert.match(globals, /@media \(min-width: 768px\) and \(max-width: 1180px\)/);
  assert.match(globals, /env\(safe-area-inset-bottom\)/);
  assert.match(globals, /\.render-lazy[\s\S]*content-visibility: auto/);
  assert.match(globals, /prefers-reduced-data: reduce/);
  assert.match(globals, /prefers-reduced-motion: reduce/);
  assert.match(layout, /viewportFit: "cover"/);

  assert.match(navigation, /app-primary-navigation/);
  assert.match(navigation, /fixed inset-x-2/);
  assert.match(navigation, /md:static/);
  assert.match(navigation, /<NavigationIcon name=\{item\.icon\}/);
  assert.match(header, /\/ninety-nine-vintage-brand\.jpg/);
  assert.match(header, /alt="나인티 나인 빈티지 공식 로고"/);
  assert.match(header, /나인티 나인 빈티지/);

  assert.match(themeToggle, /ninety-nine-theme/);
  assert.match(themeStyles, /min-height: 44px/);
});

test("uses compact static live indicators instead of perpetual sidebar animation", async () => {
  const [clock, onlineSidebar] = await Promise.all([
    source("src/components/common/AuctionClock.tsx"),
    source("src/components/live/OnlineMembersSidebar.tsx"),
  ]);

  assert.doesNotMatch(clock, /animate-pulse/);
  assert.doesNotMatch(onlineSidebar, /animate-ping|backdrop-blur/);
  assert.match(onlineSidebar, /sticky top-4/);
});

test("ships the provided brand assets with responsive picture fallbacks", async () => {
  const [auctionApp, brand, banner, profileHd] = await Promise.all([
    source("src/components/AuctionApp.tsx"),
    stat(new URL("public/ninety-nine-vintage-brand.jpg", rootUrl)),
    stat(new URL("public/ninety-nine-vintage-banner.png", rootUrl)),
    stat(new URL("public/ninety-nine-vintage-profile-hd.jpg", rootUrl)),
  ]);

  assert.ok(brand.size > 0);
  assert.ok(banner.size > 0);
  assert.ok(profileHd.size > 0);
  assert.match(auctionApp, /<picture[\s\S]*?<\/picture>/);
  assert.match(
    auctionApp,
    /media="\(min-width: 1440px\)"[\s\S]*?srcSet="\/ninety-nine-vintage-banner\.png"/,
  );
  assert.match(
    auctionApp,
    /media="\(min-width: 768px\)"[\s\S]*?srcSet="\/ninety-nine-vintage-profile-hd\.jpg"/,
  );
  assert.match(auctionApp, /src="\/ninety-nine-vintage-brand\.jpg"/);
  assert.match(auctionApp, /loading="lazy"[\s\S]*?decoding="async"/);
});
