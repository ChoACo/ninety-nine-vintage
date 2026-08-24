import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("mobile bottom navigation exposes five safe-area buyer destinations", async () => {
  const [nav, layout, dashboard] = await Promise.all([
    source("src/components/mobile/MobileSiteBottomNav.tsx"),
    source("src/components/mobile/MobileSiteLayout.tsx"),
    source("src/components/features/mypage/MyDashboard.tsx"),
  ]);

  for (const [label, href] of [
    ["홈", "/m/home"],
    ["라이브 옥션", "/m/live"],
    ["아카이브숍", "/m/shop"],
    ["보관함", "/m/account/storage"],
    ["MY", "/m/my"],
  ]) {
    assert.ok(nav.includes(`["${label}", "${href}"`));
  }
  assert.match(nav, /fixed inset-x-0 bottom-0/);
  assert.match(nav, /pb-\[max\(1rem,env\(safe-area-inset-bottom\)\)\]/);
  assert.match(layout, /overflow-x-clip/);
  assert.match(dashboard, /판매센터 바로가기/);
  assert.match(dashboard, /roleCode === "operator" \|\| adminAccess\.roleCode === "owner"/);
});

test("central and intercepted mobile dialogs resolve to safe-area bottom sheets", async () => {
  const [css, modalShell, operatorHeader, ownerHeader, payment] = await Promise.all([
    source("src/app/globals.css"),
    source("src/components/layout/ModalShell.tsx"),
    source("src/components/admin/operator/OperatorContextBar.tsx"),
    source("src/components/admin/owner/OwnerHeader.tsx"),
    source("src/components/features/account/CombinedAuctionPayment.tsx"),
  ]);

  assert.match(css, /data-premium-modal-placement="center"[\s\S]*align-items: flex-end/);
  assert.match(css, /data-premium-modal-placement="center"[\s\S]*safe-area-inset-bottom/);
  assert.match(modalShell, /items-end justify-center md:items-center/);
  assert.doesNotMatch(modalShell, /min-w-\[1280px\]/);
  assert.match(operatorHeader, /<PremiumDialog ariaLabel="운영자 빠른 이동"/);
  assert.match(ownerHeader, /<PremiumDialog ariaLabel="소유자 빠른 이동"/);
  assert.match(payment, /labelledBy="combined-auction-payment-title"/);
  assert.match(payment, /labelledBy="combined-auction-transfer-title"/);
});

test("admin financial queues provide mobile cards and keep desktop tables", async () => {
  const [ledger, revenue, payout, controller] = await Promise.all([
    source("src/components/admin/operator/sales/SalesLedgerTable.tsx"),
    source("src/components/admin/operator/OperatorRevenueConsole.tsx"),
    source("src/components/admin/owner/OwnerPayoutDesk.tsx"),
    source("src/components/admin/operator/AuctionController.tsx"),
  ]);

  for (const component of [ledger, revenue, payout, controller]) {
    assert.match(component, /md:hidden/);
    assert.match(component, /hidden overflow-x-auto[^\"]*md:block|hidden[^\"]*overflow-x-auto md:block/);
  }
});
