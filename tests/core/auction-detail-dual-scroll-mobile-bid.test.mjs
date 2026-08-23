import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

const [
  globals,
  detail,
  bidPanel,
  mobileBidBar,
  mobileBidSheet,
  bidRoute,
  dialog,
  dualScroll,
  adminWorkspace,
  conditionReport,
  historyModal,
] = await Promise.all([
  read("src/app/globals.css"),
  read("src/components/features/auction/detail/AuctionDetailView.tsx"),
  read("src/components/features/auction/detail/StickyBidPanel.tsx"),
  read("src/components/mobile/MobileBidBar.tsx"),
  read("src/components/mobile/MobileBidSheet.tsx"),
  read("src/components/features/auction/detail/AuctionBidRoutePanel.tsx"),
  read("src/components/ui/PremiumDialog.tsx"),
  read("src/components/layout/DualScrollLayout.tsx"),
  read("src/components/admin/AdminWorkspaceShell.tsx"),
  read("src/components/features/auction/detail/ConditionReport.tsx"),
  read("src/components/features/auction/AuctionBidHistoryModal.tsx"),
]);

test("desktop auction detail isolates gallery scrolling and keeps the bid panel sticky", () => {
  assert.match(detail, /data-detail-gallery-scroll/);
  assert.match(detail, /no-scrollbar/);
  assert.match(detail, /overscroll-contain/);
  assert.match(detail, /lg:h-\[calc\(100dvh-6rem\)\]/);
  assert.match(detail, /lg:overflow-y-auto/);
  assert.match(bidPanel, /data-bid-panel="sticky"/);
  assert.match(bidPanel, /sm:sticky sm:col-span-6/);
});

test("mobile auction detail exposes a safe fixed bid bar and required quick increments", () => {
  assert.match(bidPanel, /<MobileBidBar/);
  assert.match(mobileBidBar, /data-mobile-bid-bar/);
  assert.match(mobileBidBar, /fixed left-0 right-0/);
  assert.match(mobileBidBar, /lg:hidden/);
  assert.match(mobileBidBar, /currentBid\.toLocaleString\("ko-KR"\)/);
  assert.match(mobileBidBar, /remainingTime/);
  assert.match(mobileBidBar, /min-h-11/);
  assert.match(globals, /\.mobile-bid-bar[\s\S]*safe-area-inset-bottom/);
  assert.match(bidRoute, /\[1_000, 5_000, 10_000\]/);
});

test("dialogs and workspace panes contain overscroll while hiding native scrollbars", () => {
  assert.match(dialog, /lockBodyScroll\(\)/);
  assert.match(dialog, /overscroll-contain/);
  assert.match(mobileBidSheet, /no-scrollbar[\s\S]*overflow-y-auto overscroll-contain/);
  assert.match(historyModal, /no-scrollbar[\s\S]*overflow-y-auto overscroll-contain/);
  assert.match(dualScroll, /independent-scroll no-scrollbar/);
  assert.match(adminWorkspace, /independent-scroll no-scrollbar/);
  assert.match(globals, /\.no-scrollbar\s*\{[\s\S]*scrollbar-width:\s*none/);
  assert.match(globals, /\.no-scrollbar::\-webkit-scrollbar\s*\{[\s\S]*display:\s*none/);
});

test("auction detail surfaces use theme-aware semantic contrast tokens", () => {
  assert.match(bidPanel, /bg-card text-card-foreground/);
  assert.match(bidPanel, /bg-primary text-sm font-bold text-primary-foreground/);
  assert.match(conditionReport, /text-muted-foreground/);
  assert.match(conditionReport, /border-border\/50 bg-muted/);
  assert.doesNotMatch(conditionReport, /text-zinc-(?:500|600|950)/);
});
