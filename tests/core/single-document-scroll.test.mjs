import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const [globals, workspace, account, operatorChat, cart, detail, bidPanel, pcLayout, mobileLayout, mobileAutoHideHeader, ticker, pcHeader, mobileHeader] = await Promise.all([
  read("src/app/globals.css"),
  read("src/components/admin/AdminWorkspaceShell.tsx"),
  read("src/components/features/account/AccountDashboard.tsx"),
  read("src/components/admin/operator/OperatorChatConsole.tsx"),
  read("src/components/features/commerce/CartView.tsx"),
  read("src/components/features/auction/detail/AuctionDetailView.tsx"),
  read("src/components/features/auction/detail/StickyBidPanel.tsx"),
  read("src/components/layout/PcLayout.tsx"),
  read("src/components/mobile/MobileSiteLayout.tsx"),
  read("src/components/mobile/MobileAutoHideHeader.tsx"),
  read("src/components/layout/LiveTickerBar.tsx"),
  read("src/components/layout/PcHeader.tsx"),
  read("src/components/mobile/MobileSiteHeader.tsx"),
]);

test("root and primary workspaces preserve the document as the single vertical scroll context", () => {
  assert.match(globals, /html\s*\{[\s\S]*?min-height:\s*100%;[\s\S]*?overflow-y:\s*visible;/);
  assert.match(globals, /body\s*\{[\s\S]*?overflow-y:\s*visible;/);
  assert.doesNotMatch(account, /h-screen[^\n]*overflow-y-auto|overflow-hidden[^\n]*h-screen/);
  assert.doesNotMatch(operatorChat, /overflow-y-auto/);
  assert.match(workspace, /sm:sticky sm:top-6 sm:self-start/);
});

test("ticker and GNB share one sticky viewport header on desktop and mobile", () => {
  assert.match(pcLayout, /sticky top-0 z-\[70\]/);
  assert.match(pcLayout, /data-global-sticky-header/);
  assert.match(pcLayout, /backdrop-blur-md/);
  assert.match(mobileLayout, /<MobileAutoHideHeader>/);
  assert.match(mobileAutoHideHeader, /sticky top-0 z-\[70\]/);
  assert.match(mobileAutoHideHeader, /data-global-sticky-header/);
  assert.match(mobileAutoHideHeader, /backdrop-blur-md/);
  assert.doesNotMatch(ticker, /sticky top-0/);
  assert.doesNotMatch(pcHeader, /sticky/);
  assert.doesNotMatch(mobileHeader, /sticky/);
});

test("MY, cart, and product detail panels use items-start and fit-content sticky alignment", () => {
  assert.doesNotMatch(account, /h-screen[^\n]*overflow-y-auto|overflow-hidden[^\n]*h-screen/);
  assert.match(cart, /grid max-w-\[1400px\] grid-cols-1 items-start gap-6[\s\S]*sm:grid-cols-/);
  assert.match(cart, /h-fit self-start/);
  assert.match(detail, /grid w-full max-w-\[1400px\] grid-cols-1 items-start gap-6 p-0 sm:grid-cols-12/);
  assert.match(bidPanel, /h-fit self-start[\s\S]*sm:sticky sm:col-span-6/);
});
