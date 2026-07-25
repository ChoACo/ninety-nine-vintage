import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("simple mode persists on the device and synchronizes to the signed-in account", async () => {
  const [layout, provider, route, migration] = await Promise.all([
    source("src/app/layout.tsx"),
    source("src/components/features/accessibility/SimpleModeProvider.tsx"),
    source("src/app/api/account/experience/route.ts"),
    source("supabase/migrations/20260725125706_member_experience_preferences.sql"),
  ]);

  assert.match(layout, /ninety-nine:simple-mode/);
  assert.match(layout, /root\.dataset\.simpleMode/);
  assert.match(provider, /localStorage\.setItem\(SIMPLE_MODE_STORAGE_KEY/);
  assert.match(provider, /fetch\("\/api\/account\/experience"/);
  assert.match(route, /authenticateCommerceRequest\(request,\s*true\)/);
  assert.match(route, /\.upsert\(/);
  assert.match(migration, /create table public\.member_experience_preferences/i);
  assert.match(migration, /simple_mode_enabled boolean not null default false/i);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /\(select auth\.uid\(\)\) = user_id/i);
});

test("simple mode exposes only the five consumer core destinations", async () => {
  const [bottomNav, header, taskGrid] = await Promise.all([
    source("src/components/mobile/MobileSiteBottomNav.tsx"),
    source("src/components/mobile/MobileSiteHeader.tsx"),
    source("src/components/features/account/MobileAccountTaskGrid.tsx"),
  ]);

  assert.match(bottomNav, /consumerSimpleMode/);
  assert.match(bottomNav, /\["입찰", "\/m\/feed"/);
  assert.match(bottomNav, /\["구매", "\/m\/shop"/);
  assert.match(bottomNav, /\["결제·배송", "\/m\/account\/payments"/);
  assert.match(header, /\["배송 신청·현황", "\/m\/account\/shipping"/);
  assert.match(taskGrid, /simpleMode\.enabled[\s\S]*tasks\.filter/);
  assert.match(taskGrid, /grid-cols-1/);
});

test("mobile account tabs render dedicated views and tolerate partial API failures", async () => {
  const [sectionPage, dashboard] = await Promise.all([
    source("src/app/(mobile)/m/account/[section]/page.tsx"),
    source("src/components/features/account/AccountDashboard.tsx"),
  ]);

  for (const view of [
    "payments",
    "storage",
    "shipping",
    "addresses",
    "refunds",
    "saved",
  ]) {
    assert.match(sectionPage, new RegExp(`${view}: "${view}"`));
  }
  assert.match(sectionPage, /<AccountDashboard basePath="\/m" view=\{view\}/);
  assert.match(dashboard, /일부 계정 정보를 불러오지 못했습니다/);
  assert.match(dashboard, /showAddresses/);
  assert.match(dashboard, /새 배송지 추가/);
  assert.match(dashboard, /hidden=\{!showPayments\}/);
  assert.match(dashboard, /hidden=\{!showShipments\}/);
  assert.match(
    dashboard,
    /<details[\s\S]*?id="refunds"[\s\S]*?open=\{view === "refunds" \? true : undefined\}/,
  );
  assert.doesNotMatch(dashboard, /refundDetailsRef/);
});
