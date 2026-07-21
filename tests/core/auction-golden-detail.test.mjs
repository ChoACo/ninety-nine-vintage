import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  compareGarmentMeasurements,
  parseProductMeasurements,
} from "../../src/utils/productMeasurements.ts";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("garment comparison parses explicit centimeters without guessing label sizes", () => {
  const product = parseProductMeasurements(
    "SIZE 100",
    "가슴단면 56cm · 총장 72cm · 어깨 48cm · 소매 61cm",
  );
  assert.deepEqual(product, {
    chestWidthCm: 56,
    totalLengthCm: 72,
    shoulderWidthCm: 48,
    sleeveLengthCm: 61,
  });
  const comparison = compareGarmentMeasurements(product, {
    chestWidthCm: 54,
    totalLengthCm: 72,
    shoulderWidthCm: 47,
    sleeveLengthCm: 62,
    updatedAt: "2026-07-21T00:00:00.000Z",
  });
  assert.deepEqual(
    comparison.map(({ key, delta }) => ({ key, delta })),
    [
      { key: "chestWidthCm", delta: 2 },
      { key: "totalLengthCm", delta: 0 },
      { key: "shoulderWidthCm", delta: 1 },
      { key: "sleeveLengthCm", delta: -1 },
    ],
  );
  assert.deepEqual(parseProductMeasurements("SIZE 100 / M"), {});
});

test("auction detail restores inquiry, route-based bidding, full ledger, specifications, and device-local scanner", async () => {
  const [panel, inquiry, scanner, profile, chatRoute, chatPanel, modalShell, interceptedBid, directBidPage, productRoute, bidStore, productService, feedCard] = await Promise.all([
    source("src/components/features/auction/detail/StickyBidPanel.tsx"),
    source("src/components/features/auction/detail/ProductInquiryModal.tsx"),
    source("src/components/features/auction/detail/SizeComparisonScanner.tsx"),
    source("src/hooks/useGarmentSizeProfile.ts"),
    source("src/app/api/chat/route.ts"),
    source("src/components/features/chat/ChatPanel.tsx"),
    source("src/components/layout/ModalShell.tsx"),
    source("src/app/(shop)/@modal/(.)auction/[id]/bid/page.tsx"),
    source("src/app/(shop)/auction/[id]/bid/page.tsx"),
    source("src/app/api/products/[id]/route.ts"),
    source("src/store/useBidStore.ts"),
    source("src/services/products.ts"),
    source("src/components/features/auction/AuctionFeedCard.tsx"),
  ]);

  assert.match(panel, /AuctionBidHistoryModal/);
  assert.match(panel, /ProductInquiryModal/);
  assert.match(feedCard, /ProductInquiryModal/);
  assert.match(panel, /SizeComparisonScanner/);
  assert.match(panel, /item\.description/);
  assert.match(panel, /item\.category/);
  assert.match(panel, /item\.conditionGrade/);
  assert.match(inquiry, /productId/);
  assert.match(inquiry, /router\.push\(`\/chat\?conversationId=/);
  assert.match(chatRoute, /rpc\("start_product_inquiry"/);
  assert.match(chatRoute, /p_client_nonce/);
  assert.match(chatPanel, /conversationId/);
  assert.match(scanner, /parseProductMeasurements/);
  assert.match(scanner, /compareGarmentMeasurements/);
  assert.match(profile, /window\.localStorage/);
  assert.match(profile, /window\.sessionStorage/);
  assert.match(modalShell, /event\.key === "Escape"\) router\.back\(\)/);
  assert.match(modalShell, /document\.body\.style\.overflow = "hidden"/);
  assert.match(modalShell, /returnFocusRef\.current\?\.focus\(\)/);
  assert.match(modalShell, /aria-modal="true"/);
  assert.match(interceptedBid, /<ModalShell label="실시간 경매 입찰">/);
  assert.match(directBidPage, /<AuctionBidRoute productId=\{id\} \/>/);
  assert.doesNotMatch(panel, /<BidModal/);
  assert.match(
    panel,
    /fetch\(\s*`\/api\/products\/\$\{encodeURIComponent\(item\.id\)\}`/,
  );
  assert.match(panel, /replaceAuthoritative/);
  assert.match(panel, /bidLockedAt:\s*product\.bidLockedAt/);
  assert.match(panel, /participantCount:\s*product\.participantCount/);
  assert.match(productRoute, /fetchPublishedProduct\(id\)/);
  assert.match(bidStore, /finalBidId:\s*payload\.bid\.finalBidId/);
  assert.match(bidStore, /participantCount:\s*payload\.bid\.participantCount/);
  assert.doesNotMatch(productService, /data\?\.final_bid_id !== null/);
  assert.match(panel, /href=\{`\/auction\/\$\{item\.id\}\/bid`\}/);
});
