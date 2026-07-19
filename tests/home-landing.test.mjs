import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("home landing explains the service and routes first-time users", async () => {
  const home = await source("src/components/home/HomeLandingPage.tsx");

  assert.match(home, /시간을 다시 입는/);
  assert.match(home, /HOW IT WORKS/);
  assert.match(home, /상품 찾기/);
  assert.match(home, /결제·배송/);
  assert.match(home, /href="\/feed"/);
  assert.match(home, /href="\/shop"/);
  assert.match(home, /href="\/account"/);
  assert.match(home, /href="\/chat"/);
});

test("home landing uses published Supabase product props instead of demo data", async () => {
  const [home, app] = await Promise.all([
    source("src/components/home/HomeLandingPage.tsx"),
    source("src/components/AuctionApp.tsx"),
  ]);

  assert.match(home, /posts: readonly AuctionPost\[\]/);
  assert.match(home, /post\.status === "active"/);
  assert.match(home, /post\.thumbnailUrls\[0\]/);
  assert.match(app, /<HomeLandingPage[\s\S]*posts=\{posts\}/);
  assert.doesNotMatch(home, /lot099|unsplash|dummy/i);
});
