import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);

test("gives staff the auction-wide sidebar while keeping bidder names transparent", async () => {
  const [app, overview, personal, history] = await Promise.all([
    readFile(new URL("src/components/AuctionApp.tsx", rootUrl), "utf8"),
    readFile(
      new URL("src/components/live/AuctionOverviewSidebar.tsx", rootUrl),
      "utf8",
    ),
    readFile(new URL("src/components/live/LiveBidSidebar.tsx", rootUrl), "utf8"),
    readFile(new URL("src/components/feed/BidHistoryModal.tsx", rootUrl), "utf8"),
  ]);

  assert.match(
    app,
    /isMember[\s\S]*<LiveBidSidebar[\s\S]*auth\.user && isStaffRole\(auth\.role\)[\s\S]*<AuctionOverviewSidebar/,
  );
  assert.match(overview, /전체 경매 진행 현황/);
  assert.match(overview, /현재 진행 상품.*inProgressPosts\.length/);
  assert.match(overview, /post\.thumbnailUrls\[0\] \|\| post\.imageUrls\[0\]/);
  assert.match(overview, /post\.participantCount/);
  assert.doesNotMatch(overview, /내 실시간 경매 현황|onBid/);
  assert.match(personal, /내 실시간 경매 현황/);
  assert.match(history, /bid\.bidderName\.trim\(\)/);
  assert.match(history, /입찰자 닉네임·입찰 시각·금액을 모두/);
  assert.doesNotMatch(history, /maskBidder/);
});
