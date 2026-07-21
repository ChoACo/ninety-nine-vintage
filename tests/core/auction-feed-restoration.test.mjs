import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AUCTION_FEED_PAGE_SIZE,
  canStartAuctionBid,
  getAuctionFeedPhase,
  getAuctionRemainingLabel,
  getAuctionFeedBidAccess,
  getKoreanFeedDateKey,
  isActiveAuctionBid,
  paginateAuctionFeed,
  parseAuctionProductRealtimeSnapshot,
  parsePublicBidHistory,
} from "../../src/components/features/auction/auctionFeedLogic.ts";
import {
  getAuctionBidDecision,
  getDailyAuctionPhase,
} from "../../src/utils/auctionBidPolicy.ts";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("auction feed keeps a stable 24-item page boundary", () => {
  assert.equal(AUCTION_FEED_PAGE_SIZE, 24);
  const items = Array.from({ length: 53 }, (_, index) => index + 1);
  assert.deepEqual(paginateAuctionFeed(items, 2), {
    items: items.slice(24, 48),
    page: 2,
    pageCount: 3,
  });
  assert.deepEqual(paginateAuctionFeed(items, 99).items, items.slice(48));
  assert.equal(paginateAuctionFeed(items, 0).page, 1);
});

test("feed bid access follows first-bid and configured increment rules", () => {
  assert.deepEqual(
    getAuctionFeedBidAccess({ bidCount: 0, currentPrice: 20_000, phase: "CLOSING_SOON" }),
    {
      canBid: true,
      firstBidFinal: true,
      hasAnyBid: false,
      hasParticipated: false,
      minimumBid: 20_000,
    },
  );
  assert.equal(getAuctionFeedBidAccess({ bidCount: 3, bidIncrement: 2_500, currentPrice: 30_000, phase: "OPEN" }).minimumBid, 32_500);
  assert.equal(getAuctionFeedBidAccess({ bidCount: 3, currentPrice: 30_000, phase: "CLOSING_SOON" }).canBid, false);
  assert.equal(getAuctionFeedBidAccess({ bidCount: 3, currentPrice: 30_000, participationState: "outbid", phase: "CLOSING_SOON" }).canBid, true);
  assert.equal(getAuctionFeedBidAccess({ bidCount: 3, currentPrice: 30_000, participationState: "final", phase: "CLOSING_SOON" }).canBid, false);
  assert.equal(getAuctionFeedBidAccess({ bidCount: 3, currentPrice: 30_000, participationState: "closed", phase: "CLOSING_SOON" }).canBid, false);
  assert.equal(getAuctionFeedBidAccess({ bidCount: 0, currentPrice: 30_000, phase: "CLOSED" }).canBid, false);
});

test("only guests and eligible members can start the bid flow", () => {
  assert.equal(canStartAuctionBid("guest"), true);
  assert.equal(canStartAuctionBid("eligible_member"), true);
  assert.equal(canStartAuctionBid("checking"), false);
  assert.equal(canStartAuctionBid("non_member"), false);
  assert.equal(canStartAuctionBid("unavailable"), false);
});

test("public ledger parsing preserves public nicknames and rejects malformed amounts", () => {
  assert.deepEqual(parsePublicBidHistory([
    { id: "bid-1", amount: 15_000, bidAt: "2026-07-20T15:30:00Z", bidderName: "auction-user" },
    { id: "bid-2", amount: -1, bidderName: "invalid" },
  ]), [{ id: "bid-1", amount: 15_000, bidAt: "2026-07-20T15:30:00Z", bidderName: "auction-user", outcome: "active" }]);
  assert.equal(getKoreanFeedDateKey("2026-07-20T15:30:00Z"), "2026-07-21");
});

test("cancelled-only bid history remains auditable but never counts as active", () => {
  const history = parsePublicBidHistory([
    { id: "cancelled-1", amount: 22_000, bidAt: "2026-07-21T11:55:00Z", bidderName: "former-user", outcome: "cancelled" },
    { id: "invalid-1", amount: 30_000, bidAt: "2026-07-21T11:56:00Z", bidderName: "invalid-user", outcome: "unknown" },
  ]);
  assert.deepEqual(history, [{
    id: "cancelled-1",
    amount: 22_000,
    bidAt: "2026-07-21T11:55:00Z",
    bidderName: "former-user",
    outcome: "cancelled",
  }]);
  assert.deepEqual(history.filter(isActiveAuctionBid), []);
  assert.equal(getAuctionFeedBidAccess({
    bidCount: history.filter(isActiveAuctionBid).length,
    currentPrice: 20_000,
    phase: "CLOSING_SOON",
  }).firstBidFinal, true);

  const decision = getAuctionBidDecision({
    currentUserName: "new-user",
    now: "2026-07-21T11:57:00Z",
    post: {
      bidHistory: [{ bidderName: "former-user", outcome: "cancelled" }],
      closesAt: "2026-07-22T12:00:00Z",
      status: "active",
    },
  });
  assert.equal(decision.hasAnyBidHistory, false);
  assert.equal(decision.finalOnAccept, true);
  assert.equal(decision.reason, "empty-item-first-bid");
});

test("product realtime snapshots expose only auction policy fields", () => {
  const snapshot = parseAuctionProductRealtimeSnapshot({
    anti_sniping_base_closes_at: "2026-07-21T11:57:00Z",
    anti_sniping_extended_at: "2026-07-21T11:58:00Z",
    anti_sniping_extension_count: 2,
    id: "product-1",
    sale_type: "auction",
    current_price: 25_000,
    participant_count: 3,
    bid_locked_at: null,
    final_bid_amount: null,
    publish_at: "2026-07-21T10:00:00Z",
    closes_at: "2026-07-21T12:00:00Z",
    status: "active",
    bid_history: [{ bidderName: "private-name", amount: 25_000 }],
  });
  assert.deepEqual(snapshot, {
    antiSnipingBaseClosesAt: "2026-07-21T11:57:00Z",
    antiSnipingExtendedAt: "2026-07-21T11:58:00Z",
    antiSnipingExtensionCount: 2,
    bidLockedAt: null,
    closesAt: "2026-07-21T12:00:00Z",
    currentPrice: 25_000,
    finalBidAmount: null,
    id: "product-1",
    participantCount: 3,
    publishAt: "2026-07-21T10:00:00Z",
    status: "active",
  });
  assert.equal(Object.hasOwn(snapshot, "bidHistory"), false);
  assert.equal(parseAuctionProductRealtimeSnapshot({ ...snapshot, sale_type: "fixed" }), null);
  assert.equal(parseAuctionProductRealtimeSnapshot({
    anti_sniping_base_closes_at: null,
    anti_sniping_extended_at: null,
    anti_sniping_extension_count: -1,
    bid_locked_at: null,
    closes_at: "2026-07-21T12:00:00Z",
    current_price: 25_000,
    final_bid_amount: null,
    id: "product-1",
    participant_count: 3,
    publish_at: "2026-07-21T10:00:00Z",
    sale_type: "auction",
    status: "active",
  }), null);
});

test("auction phase and countdown use the supplied synchronized clock", () => {
  const product = {
    bidLockedAt: null,
    closesAt: "2026-07-21T12:00:00Z",
    publishAt: "2026-07-21T10:00:00Z",
    status: "active",
  };
  const openNow = Date.parse("2026-07-21T11:55:59Z");
  const cutoffNow = Date.parse("2026-07-21T11:56:00Z");
  const closeNow = Date.parse("2026-07-21T12:00:00Z");
  assert.equal(getAuctionFeedPhase(product, openNow, getDailyAuctionPhase(openNow)), "OPEN");
  assert.equal(getAuctionFeedPhase(product, cutoffNow, getDailyAuctionPhase(cutoffNow)), "CLOSING_SOON");
  assert.equal(getAuctionFeedPhase(product, closeNow, getDailyAuctionPhase(closeNow)), "CLOSED");
  assert.equal(getAuctionRemainingLabel(product.closesAt, Date.parse("2026-07-21T11:59:58Z")), "00:00:02");
  assert.equal(getAuctionRemainingLabel(product.closesAt, 0), "--:--:--");
});

test("21:00-22:00 KST blackout closes a no-bid lot even with a next-day close", () => {
  const now = Date.parse("2026-07-21T12:30:00Z"); // 2026-07-21 21:30 KST
  const dailyPhase = getDailyAuctionPhase(now);
  const product = {
    bidLockedAt: null,
    closesAt: "2026-07-22T12:00:00Z",
    publishAt: "2026-07-21T01:00:00Z",
    status: "active",
  };
  const phase = getAuctionFeedPhase(product, now, dailyPhase);
  assert.equal(dailyPhase, "closed");
  assert.equal(phase, "CLOSED");
  assert.equal(getAuctionFeedBidAccess({ bidCount: 0, currentPrice: 20_000, phase }).canBid, false);

  const decision = getAuctionBidDecision({
    currentUserName: "new-user",
    now,
    post: { bidHistory: [], closesAt: product.closesAt, status: "active" },
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "auction-closed");
});

test("a server-recorded anti-sniping overtime stays closing-soon during the daily blackout", () => {
  const now = Date.parse("2026-07-21T12:30:00Z"); // 2026-07-21 21:30 KST
  const dailyPhase = getDailyAuctionPhase(now);
  assert.equal(dailyPhase, "closed");
  assert.equal(getAuctionFeedPhase({
    antiSnipingBaseClosesAt: "2026-07-21T12:00:00Z",
    antiSnipingExtendedAt: "2026-07-21T12:29:00Z",
    antiSnipingExtensionCount: 2,
    bidLockedAt: null,
    closesAt: "2026-07-21T12:33:00Z",
    publishAt: "2026-07-21T01:00:00Z",
    status: "active",
  }, now, dailyPhase), "CLOSING_SOON");
});

test("restored feed UI uses responsive V2 routes and authoritative account and product APIs", async () => {
  const [feedPage, grid, card, summary, bidRoutePanel, interceptedBid, history, gallery, detailPanel, bidApi, productApi, productService, detailView] = await Promise.all([
    source("src/app/(shop)/feed/page.tsx"),
    source("src/components/features/auction/AuctionFeedGrid.tsx"),
    source("src/components/features/auction/AuctionFeedCard.tsx"),
    source("src/components/features/auction/AuctionBidSummary.tsx"),
    source("src/components/features/auction/detail/AuctionBidRoutePanel.tsx"),
    source("src/app/(shop)/@modal/(.)auction/[id]/bid/page.tsx"),
    source("src/components/features/auction/AuctionBidHistoryModal.tsx"),
    source("src/components/features/auction/AuctionGalleryModal.tsx"),
    source("src/components/features/auction/detail/StickyBidPanel.tsx"),
    source("src/app/api/auction/bids/route.ts"),
    source("src/app/api/products/route.ts"),
    source("src/services/products.ts"),
    source("src/components/features/auction/detail/AuctionDetailView.tsx"),
  ]);
  assert.match(feedPage, /className="md:flex md:items-start md:gap-10"/);
  assert.match(grid, /paginateAuctionFeed\(visibleCards, page\)/);
  assert.match(grid, />브랜드<select/);
  assert.match(grid, />카테고리<select/);
  assert.match(grid, />성별<select/);
  assert.match(summary, /fetch\("\/api\/account\/bids"/);
  assert.doesNotMatch(card, /fetch\("\/api\/auction\/bids"/);
  assert.match(card, /AuctionBidHistoryModal/);
  assert.match(history, /공개 입찰 원장 · 읽기 전용/);
  assert.match(bidRoutePanel, /fetch\("\/api\/auction\/bids"/);
  assert.match(bidRoutePanel, /body: JSON\.stringify\(\{ amount: numericAmount, productId \}\)/);
  assert.match(bidRoutePanel, /낙찰 후 안내된 결제 기한과 미결제 시 차순위 전환 규칙/);
  assert.match(interceptedBid, /<ModalShell label="실시간 경매 입찰">/);
  assert.match(interceptedBid, /<AuctionBidRoute productId=\{id\} \/>/);
  assert.match(grid, /table: "products"/);
  assert.match(grid, /event: "UPDATE"/);
  assert.match(grid, /antiSnipingBaseClosesAt: snapshot\.antiSnipingBaseClosesAt/);
  assert.match(grid, /antiSnipingExtendedAt: snapshot\.antiSnipingExtendedAt/);
  assert.match(grid, /antiSnipingExtensionCount: snapshot\.antiSnipingExtensionCount/);
  assert.match(grid, /useAuctionPolicyClock/);
  assert.match(grid, /getDailyAuctionPhase/);
  assert.doesNotMatch(grid, /table: "auction_bids"/);
  assert.match(detailPanel, /table: "products"/);
  assert.match(detailPanel, /useAuctionPolicyClock/);
  assert.match(detailPanel, /useAccountAuctionBids/);
  assert.match(detailPanel, /getAuctionFeedBidAccess/);
  assert.match(detailPanel, /canStartAuctionBid\(bidCapability\)/);
  assert.match(
    detailPanel,
    /canStartBid\s*\?\s*\(?\s*<Link[\s\S]*?href=\{`\/auction\/\$\{item\.id\}\/bid`\}/,
  );
  assert.doesNotMatch(detailPanel, /\breadOnly\b/);
  assert.match(detailPanel, /participationState === "final"/);
  assert.match(detailPanel, /getDailyAuctionPhase/);
  assert.doesNotMatch(detailPanel, /table: "auction_bids"/);
  assert.match(productService, /outcome:\s*outcome/);
  assert.match(productService, /bidderName,\s*\n/);
  assert.doesNotMatch(productService, /maskBidderName|maskPublicBidHistory/);
  assert.match(bidApi, /return response\(\{ bid \}, 200\)/);
  assert.doesNotMatch(bidApi, /maskBidder/);
  assert.match(productApi, /\.\.\.product/);
  assert.match(detailView, /outcome/);
  assert.match(history, /최신 유효 입찰/);
  assert.match(history, /미결제로 무효/);
  assert.match(gallery, /useEmblaCarousel/);
  assert.match(gallery, /loop:\s*true/);
  assert.match(gallery, /emblaApi\?\.scrollPrev\(\)/);
  assert.match(gallery, /emblaApi\?\.scrollNext\(\)/);
  assert.match(gallery, /event\.key === "Escape"/);
  assert.match(gallery, /const releaseBodyScroll = lockBodyScroll\(\)/);
  assert.match(gallery, /releaseBodyScroll\(\)/);
  assert.match(gallery, /returnFocusRef\.current\?\.focus\(\)/);
  assert.match(gallery, /addEventListener\("wheel", onWheel, \{ passive: false \}\)/);
  assert.match(gallery, /zoomAtPoint\(transformRef\.current/);
  assert.match(gallery, /pinchTransform\(/);
  assert.match(gallery, /pointerType === "touch"/);
  assert.match(gallery, /data-zoom-scale=/);
  assert.match(gallery, /data-pan-x=/);
  assert.match(gallery, /watchDrag: false/);
  assert.match(gallery, /maxDimension=\{3200\}/);
  assert.match(gallery, /unoptimized/);
  assert.match(gallery, /md:hidden/);
  assert.match(gallery, /md:grid/);
});

test("account auction state is complete and member capability gates the feed", async () => {
  const [migration, accountApi, databaseTypes, summary, grid, card] = await Promise.all([
    source("supabase/migrations/20260721040000_list_account_auction_bid_states.sql"),
    source("src/app/api/account/bids/route.ts"),
    source("src/lib/supabase/database.types.ts"),
    source("src/components/features/auction/AuctionBidSummary.tsx"),
    source("src/components/features/auction/AuctionFeedGrid.tsx"),
    source("src/components/features/auction/AuctionFeedCard.tsx"),
  ]);

  assert.match(migration, /security definer/i);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /public\.is_member\(\)/);
  assert.match(migration, /auction_bids \(bidder_id, product_id, created_at desc, id desc\)/i);
  assert.match(migration, /distinct on \(bids\.product_id\)/i);
  assert.match(migration, /order by bids\.product_id, bids\.created_at desc, bids\.id desc/i);
  assert.match(migration, /revoke all on function public\.list_account_auction_bid_states\(\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.list_account_auction_bid_states\(\) to authenticated/i);

  assert.match(accountApi, /\.rpc\(\s*"list_account_auction_bid_states"/);
  assert.doesNotMatch(accountApi, /\.limit\(100\)/);
  assert.doesNotMatch(accountApi, /\.from\("auction_bids"\)/);
  assert.match(accountApi, /bidCapability:\s*"eligible_member"/);
  assert.match(databaseTypes, /list_account_auction_bid_states/);

  assert.match(summary, /response\.status === 403/);
  assert.match(summary, /responsePayload\.error === "member_required"/);
  assert.match(summary, /\?\s*"non_member"/);
  assert.match(grid, /accountBidCapability === "eligible_member"/);
  assert.match(grid, /bidCapability=\{accountBidCapability\}/);
  assert.match(card, /canStartAuctionBid\(bidCapability\)/);
  assert.match(
    card,
    /canStartBid\s*\?\s*\(?\s*<Link[\s\S]*?href=\{`\/auction\/\$\{item\.id\}\/bid`\}/,
  );
  assert.doesNotMatch(card, /\breadOnly\b/);
  assert.match(card, /현재 로그인한 계정은 경매 입찰용 회원 계정이 아닙니다\./);
});
