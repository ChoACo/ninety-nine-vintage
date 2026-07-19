import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const soldFeedUrl = new URL(
  "../src/components/feed/SoldAuctionFeed.tsx",
  import.meta.url,
);

test("home sold feed renders a compact six-item grid and links to the archive", async () => {
  const [source, hook] = await Promise.all([
    readFile(soldFeedUrl, "utf8"),
    readFile(
      new URL("../src/hooks/usePublicSoldAuctions.ts", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(source, /const RECENT_SOLD_ITEMS = 6/);
  assert.match(source, /auctions\.slice\(0, RECENT_SOLD_ITEMS\)/);
  assert.match(source, /href="\/sold"/);
  assert.match(source, /prefetch=\{false\}/);
  assert.match(source, /aria-label="판매 완료 상품 전체보기"/);
  assert.match(source, /aria-label="최근 낙찰 현황 요약"/);
  assert.match(source, /lg:grid-cols-6/);
  assert.doesNotMatch(source, /useState|VISIBLE_SOLD_STEP|판매 완료 더 보기/);
  assert.match(hook, /const RECENT_SOLD_AUCTION_LIMIT = 9/);
  assert.match(
    hook,
    /fetchPublicSoldAuctions\(\{ limit: RECENT_SOLD_AUCTION_LIMIT \}\)/,
  );

  assert.match(source, /formatKRW\(auction\.winningAmount\)/);
  assert.match(source, /auction\.winnerDisplayName/);
  assert.match(source, /판매 완료 상품을 불러오는 중/);
  assert.match(source, /onRetry/);
});

test("sold archive brand mark always returns to the home landing", async () => {
  const archive = await readFile(
    new URL("../src/components/sold/SoldArchivePage.tsx", import.meta.url),
    "utf8",
  );

  assert.match(archive, /href="\/"[\s\S]*aria-label="나인티 나인 빈티지 홈"/);
  assert.doesNotMatch(archive, /href="\/feed"[\s\S]*aria-label="나인티 나인 빈티지 홈"/);
  assert.match(archive, /<Navigation[\s\S]*activePage="sold"/);
});
