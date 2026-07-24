import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("single registration accepts optional catalog fields and preserves blanks", async () => {
  const [consoleSource, route, migration, productsService, filters] =
    await Promise.all([
      source("src/components/admin/operator/OperatorProductsConsole.tsx"),
      source("src/app/api/admin/operator/products/route.ts"),
      source("supabase/migrations/20260724123534_owner_member_mode_product_gender.sql"),
      source("src/services/products.ts"),
      source("src/utils/catalogFilters.ts"),
    ]);

  assert.match(consoleSource, /상품명 \(선택\)/);
  assert.match(consoleSource, /브랜드명 \(선택\)/);
  assert.match(consoleSource, /성별 미입력/);
  assert.match(consoleSource, /상태등급 미입력/);
  assert.match(route, /gender/);
  assert.match(route, /brandSlug: ""/);
  assert.match(route, /condition_grade: singleRegistration/);
  assert.match(migration, /add column if not exists gender/);
  assert.match(migration, /condition_grade in \('', 'S', 'A\+', 'A', 'B'\)/);
  assert.match(productsService, /formatProductDisplayNumber\(row\.id\)/);
  assert.match(filters, /post\.gender === "남성"/);
});

test("the immutable owner receives a server-timed three-minute member mode", async () => {
  const [migration, constants, route, provider, serverAuth, dashboard] = await Promise.all([
    source("supabase/migrations/20260724123534_owner_member_mode_product_gender.sql"),
    source("src/lib/ownerMemberMode.ts"),
    source("src/app/api/owner/member-mode/route.ts"),
    source("src/components/features/auth/OwnerMemberModeProvider.tsx"),
    source("src/lib/commerce/server.ts"),
    source("src/components/admin/owner/OwnerDashboard.tsx"),
  ]);

  for (const text of [migration, constants]) {
    assert.match(text, /30be08c2-6259-42c6-af26-4ded6362de12/);
  }
  assert.match(migration, /insert into public\.member_accounts/);
  assert.match(migration, /when public\.owner_member_mode_is_active\(p_user_id\) then 'member'/);
  assert.match(route, /OWNER_MEMBER_MODE_DURATION_MS/);
  assert.match(route, /action === "extend"/);
  assert.match(route, /action === "end"/);
  assert.match(provider, /3분 연장/);
  assert.match(provider, /즉시 종료/);
  assert.match(provider, /remainingSeconds/);
  assert.match(serverAuth, /member_mode_active/);
  assert.match(dashboard, /3분간 회원 권한 활성화/);
});

test("brand choices are derived from the complete registered-product catalog", async () => {
  const feed = await source(
    "src/components/features/auction/AuctionFeedGrid.tsx",
  );

  assert.doesNotMatch(feed, /input\.query/);
  assert.match(feed, /cards\.map\(\(card\) => card\.brand\.trim\(\)\)\.filter\(Boolean\)/);
  assert.match(feed, /brands: brandOptions\.filter/);
});
