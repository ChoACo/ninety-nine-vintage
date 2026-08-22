import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const [globals, workspace, account, operatorChat, cart, detail, bidPanel, pcLayout, mobileLayout, ticker, pcHeader, mobileHeader] = await Promise.all([
  read("src/app/globals.css"),
  read("src/components/admin/AdminWorkspaceShell.tsx"),
  read("src/components/features/account/DesktopAccountContent.tsx"),
  read("src/components/admin/operator/OperatorChatConsole.tsx"),
  read("src/components/features/commerce/CartView.tsx"),
  read("src/components/features/auction/detail/AuctionDetailView.tsx"),
  read("src/components/features/auction/detail/StickyBidPanel.tsx"),
  read("src/components/layout/PcLayout.tsx"),
  read("src/components/mobile/MobileSiteLayout.tsx"),
  read("src/components/layout/LiveTickerBar.tsx"),
  read("src/components/layout/PcHeader.tsx"),
  read("src/components/mobile/MobileSiteHeader.tsx"),
]);

test("root and primary workspaces preserve the document as the single vertical scroll context", () => {
  assert.match(globals, /html\s*\{[\s\S]*?min-height:\s*100%;[\s\S]*?overflow-y:\s*visible;/);
  assert.match(globals, /body\s*\{[\s\S]*?overflow-y:\s*visible;/);
  assert.doesNotMatch(account, /overflow-y-auto/);
  assert.doesNotMatch(operatorChat, /overflow-y-auto/);
  assert.match(workspace, /lg:sticky lg:top-6 lg:self-start/);
});

test("ticker and GNB share one sticky viewport header on desktop and mobile", () => {
  for (const layout of [pcLayout, mobileLayout]) {
    assert.match(layout, /sticky top-0 z-\[70\]/);
    assert.match(layout, /data-global-sticky-header/);
    assert.match(layout, /backdrop-blur-md/);
  }
  assert.doesNotMatch(ticker, /sticky top-0/);
  assert.doesNotMatch(pcHeader, /sticky/);
  assert.doesNotMatch(mobileHeader, /sticky/);
});

test("MY, cart, and product detail panels use items-start and fit-content sticky alignment", () => {
  assert.match(account, /grid items-start/);
  assert.match(account, /h-fit[^"]*md:sticky[^"]*md:self-start/);
  assert.match(cart, /grid items-start gap-10/);
  assert.match(cart, /h-fit self-start/);
  assert.match(detail, /grid items-start gap-8/);
  assert.match(bidPanel, /sticky col-span-5 p-6 pb-6 h-fit/);
});
