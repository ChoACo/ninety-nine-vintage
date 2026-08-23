import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("owner main management provides mobile-safe toggles, ordering controls, and compressed banner uploads", async () => {
  const [manager, page, home, mobileHome] = await Promise.all([
    source("src/components/admin/owner/OwnerSiteAdministration.tsx"),
    source("src/app/(admin)/admin/owner/platform/page.tsx"),
    source("src/app/(shop)/home/page.tsx"),
    source("src/app/(mobile)/m/home/page.tsx"),
  ]);
  assert.match(manager, /min-h-11 min-w-11/);
  assert.match(manager, /ArrowUp/);
  assert.match(manager, /ArrowDown/);
  assert.match(manager, /moveBanner\(index, -1\)/);
  assert.match(manager, /moveBanner\(index, 1\)/);
  assert.match(manager, /draggable/);
  assert.match(manager, /moveBannerTo\(draggedBannerId, banner\.id\)/);
  assert.match(manager, /compressProductImageForUpload\(file\)/);
  assert.match(manager, /\.from\("platform-content"\)/);
  assert.match(page, /<OwnerSiteAdministration \/>/);
  assert.match(home, /config\.homeSections\.archiveShop/);
  assert.match(home, /config\.homeSections\.centerMall/);
  assert.match(mobileHome, /banners=\{config\.banners\}/);
});

test("seller organization exposes desktop table, mobile cards, numeric commission input, and approval badges", async () => {
  const [stores, onboarding] = await Promise.all([
    source("src/components/admin/owner/OwnerStoreManagementConsole.tsx"),
    source("src/components/admin/owner/NewCenterModal.tsx"),
  ]);
  assert.match(stores, /hidden w-full text-left text-xs md:table/);
  assert.match(stores, /flex flex-col gap-3 p-3 md:hidden/);
  assert.match(stores, /승인 완료/);
  assert.match(stores, /심사 중/);
  assert.match(stores, /운영 중지/);
  assert.match(onboarding, /key==="commissionRate"\?"decimal"/);
  assert.match(onboarding, /pattern=\{key==="commissionRate"\?"\[0-9\]\*"/);
});

test("settlement desk formats won, copies accounts with feedback, and confirms completion", async () => {
  const [desk, dialog] = await Promise.all([
    source("src/components/admin/owner/OwnerPayoutDesk.tsx"),
    source("src/components/ui/ConfirmDialog.tsx"),
  ]);
  assert.match(desk, /new Intl\.NumberFormat\("ko-KR"\)\.format\(value\)/);
  assert.match(desk, /navigator\.clipboard\.writeText/);
  assert.match(desk, /계좌번호를 클립보드에 복사했습니다/);
  assert.match(desk, /<ConfirmDialog/);
  assert.match(desk, /정산 지급 완료 확정/);
  assert.match(dialog, /<PremiumDialog/);
});

test("platform config is RLS-protected, CAS-updated, typed, and consumed by cart and PDP", async () => {
  const [migration, types, cart, pdp, route] = await Promise.all([
    source("supabase/migrations/20260823075255_owner_site_administration_config.sql"),
    source("src/lib/supabase/database.types.ts"),
    source("src/components/features/commerce/CartView.tsx"),
    source("src/components/features/shop/detail/VaultShippingBanner.tsx"),
    source("src/app/api/platform-config/route.ts"),
  ]);
  assert.match(migration, /create table if not exists public\.platform_config/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /grant select on table public\.platform_config to anon, authenticated/);
  assert.match(migration, /if v_current\.version <> p_expected_version/);
  assert.match(migration, /not public\.is_owner\(\)/);
  assert.match(migration, /coalesce\(s\.regular_shipping_fee,v_default_delivery_fee\)/);
  assert.match(migration, /'platform-content'/);
  assert.match(types, /platform_config: \{/);
  assert.match(types, /update_owner_platform_config: \{/);
  assert.match(cart, /platformConfig\.storageDurationDays/);
  assert.match(pdp, /config\.globalDeliveryFee/);
  assert.match(route, /\.from\("platform_config"\)/);
});

test("audit log has KST and relative timestamps, colored actions, quick filters, and responsive records", async () => {
  const audit = await source("src/components/admin/owner/OwnerAuditLogConsole.tsx");
  assert.match(audit, /timeZone: "Asia\/Seoul"/);
  assert.match(audit, /방금 전/);
  assert.match(audit, /분 전/);
  assert.match(audit, /AUTH_LOGIN/);
  assert.match(audit, /SETTLEMENT_APPROVED/);
  assert.match(audit, /ITEM_DELETED/);
  assert.match(audit, /CONFIG_CHANGED/);
  assert.match(audit, /\['all','전체'\]/);
  assert.match(audit, /flex flex-col gap-3 md:hidden/);
  assert.match(audit, /hidden overflow-x-auto border border-line md:block/);
});
