import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("exposes reusable high-end commerce primitives with accessible motion fallbacks", async () => {
  const [globals, button, modal, toast] = await Promise.all([
    source("app/globals.css"),
    source("src/components/common/Button.tsx"),
    source("src/components/common/Modal.tsx"),
    source("src/components/common/Toast.tsx"),
  ]);

  assert.match(globals, /\.commerce-numeric[\s\S]*font-variant-numeric: tabular-nums/);
  assert.match(globals, /\.commerce-skeleton::after[\s\S]*commerce-shimmer/);
  assert.match(globals, /\.commerce-empty-state/);
  assert.match(globals, /@media \(prefers-reduced-motion: reduce\)/);

  assert.match(button, /transition-all duration-200 ease-out/);
  assert.match(button, /hover:scale-\[1\.02\]/);
  assert.match(button, /focus-visible:ring-2/);
  assert.match(modal, /items-end[\s\S]*sm:items-center/);
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /focusableSelector/);
  assert.match(toast, /aria-live="polite"/);
});

test("keeps auction urgency in the visual layer while preserving the policy clock", async () => {
  const [clock, auctionApp] = await Promise.all([
    source("src/components/common/AuctionClock.tsx"),
    source("src/components/AuctionApp.tsx"),
  ]);

  assert.match(clock, /countdown\.totalSeconds <= 10 \* 60/);
  assert.match(clock, /countdown\.totalSeconds <= 60 \* 60/);
  assert.match(clock, /auction-urgency-critical/);
  assert.match(clock, /auction-urgency-soon/);
  assert.match(clock, /font-mono[\s\S]*tabular-nums[\s\S]*tracking-tight/);
  assert.doesNotMatch(clock, /animate-pulse/);

  assert.match(auctionApp, /<AuctionClock \/>/);
  assert.match(auctionApp, /<FeedList[\s\S]*onBid=\{handleBid\}/);
  assert.match(auctionApp, /<SoldAuctionFeed/);
  assert.match(auctionApp, /commerce-skeleton/);
});

test("uses dense commerce surfaces for feed, operations, chat, and account payment", async () => {
  const [feed, card, admin, chat, account] = await Promise.all([
    source("src/components/feed/FeedList.tsx"),
    source("src/components/feed/PostCard.tsx"),
    source("src/components/admin/AdminPage.tsx"),
    source("src/components/chat/StaffChatInbox.tsx"),
    source("src/components/profile/AccountPage.tsx"),
  ]);

  assert.match(feed, /<FeedSkeleton/);
  assert.match(feed, /EmptyRackIcon/);
  assert.match(card, /font-mono[\s\S]*tabular-nums[\s\S]*tracking-tight/);
  assert.match(card, /transition-all duration-200 ease-out/);

  assert.match(admin, /OPERATIONS CENTER/);
  assert.match(admin, /lg:grid-cols-\[210px_minmax\(0,1fr\)\]/);
  assert.match(admin, /font-mono[\s\S]*tabular-nums/);
  assert.match(chat, /aria-live="polite"/);
  assert.match(chat, /<time[\s\S]*font-mono[\s\S]*tabular-nums/);

  assert.match(account, /ManualTransferPaymentModal/);
  assert.match(account, /PortOnePaymentModal/);
  assert.match(account, /commerce-skeleton/);
  assert.match(account, /font-mono[\s\S]*tabular-nums[\s\S]*tracking-tight/);
});
