import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("single registration requires a feed title while keeping description and catalog details optional", async () => {
  const [
    consoleSource,
    route,
    migration,
    productTextConstraintMigration,
    legacyProductTitleMigration,
    paymentOrderNameMigration,
    productsService,
    filters,
  ] =
    await Promise.all([
      source("src/components/admin/operator/OperatorProductsConsole.tsx"),
      source("src/app/api/admin/operator/products/route.ts"),
      source("supabase/migrations/20260724123534_owner_member_mode_product_gender.sql"),
      source("supabase/migrations/20260730000920_require_product_title_allow_blank_description.sql"),
      source("supabase/migrations/20260730040925_normalize_legacy_blank_product_titles.sql"),
      source("supabase/migrations/20260730000215_normalize_blank_manual_transfer_order_names.sql"),
      source("src/services/products.ts"),
      source("src/utils/catalogFilters.ts"),
    ]);

  assert.match(consoleSource, /상품명 \(필수\)" required/);
  assert.match(consoleSource, /상품 설명 \(선택\)/);
  assert.match(consoleSource, /required=\{Boolean\(editingId\)\}/);
  assert.match(consoleSource, /!form\.title\.trim\(\)[\s\S]*상품명을 입력해 주세요/);
  assert.match(consoleSource, /성별 미입력/);
  assert.match(consoleSource, /브랜드 \(선택\)/);
  assert.match(consoleSource, /카테고리 미입력/);
  assert.match(consoleSource, /사이즈 \(선택\)/);
  assert.doesNotMatch(consoleSource, /상태등급 미입력/);
  assert.match(consoleSource, /aria-label="즉시구매 가격"/);
  assert.match(consoleSource, /aria-label="경매 시작가"/);
  assert.match(
    consoleSource,
    /<TextArea aria-label="상품 설명"/,
  );
  assert.match(route, /!title \|\| title\.length > 160/);
  assert.match(route, /\(!singleRegistration && !description\)/);
  assert.match(route, /description\.length > 10000/);
  assert.match(route, /gender/);
  assert.match(route, /normalizeProductBrand\("빈티지"\)/);
  assert.match(route, /condition_grade: singleRegistration/);
  assert.match(migration, /add column if not exists gender/);
  assert.match(migration, /condition_grade in \('', 'S', 'A\+', 'A', 'B'\)/);
  assert.match(
    productTextConstraintMigration,
    /products_title_length_check[\s\S]*between 1 and 160\)[\s\S]*not valid/,
  );
  assert.match(
    productTextConstraintMigration,
    /products_description_length_check[\s\S]*between 0 and 10000/,
  );
  assert.match(
    legacyProductTitleMigration,
    /update public\.products[\s\S]*nullif\(btrim\(description\), ''\)[\s\S]*where nullif\(btrim\(title\), ''\) is null/,
  );
  assert.match(
    legacyProductTitleMigration,
    /validate constraint products_title_length_check/,
  );
  assert.match(
    paymentOrderNameMigration,
    /before insert or update of product_id, order_name[\s\S]*manual_transfer_orders/,
  );
  assert.match(
    paymentOrderNameMigration,
    /new\.order_name = ''[\s\S]*'상품 No\. '/,
  );
  for (const constant of ["2166136261", "16777619", "4294967295", "999900"]) {
    assert.match(paymentOrderNameMigration, new RegExp(constant));
  }
  assert.match(productsService, /formatProductDisplayNumber\(row\.id\)/);
  assert.match(filters, /post\.gender === "남성"/);
});

test("owner member mode is retired in favor of a dedicated production member account", async () => {
  const [
    legacyMigration,
    roleContractRepair,
    creditRepair,
    retirement,
    checkoutEligibility,
    testMemberRoute,
    testMemberServer,
    testMemberPage,
    ownerMemberAccessRoute,
    ownerMemberAccessPanel,
    ownerReturnControl,
    sessionAccessMigration,
    clientAuth,
    serverAuth,
    dashboard,
  ] = await Promise.all([
    source("supabase/migrations/20260724123534_owner_member_mode_product_gender.sql"),
    source("supabase/migrations/20260811094959_restore_hidden_test_member_role_contract.sql"),
    source("supabase/migrations/20260811095613_fix_hidden_test_initial_shipping_credits.sql"),
    source("supabase/migrations/20260811194500_retire_owner_member_mode.sql"),
    source("supabase/migrations/20260811202500_allow_production_test_member_checkout.sql"),
    source("src/app/api/auth/test-member/route.ts"),
    source("src/lib/productionTestMember.server.ts"),
    source("src/app/(shop)/account/test-member/page.tsx"),
    source("src/app/api/admin/owner/member-access/route.ts"),
    source("src/components/admin/owner/OwnerMemberAccessPanel.tsx"),
    source("src/components/features/account/OwnerReturnControl.tsx"),
    source("supabase/migrations/20260812090000_record_owner_test_member_session_access.sql"),
    source("src/lib/supabase/auth.ts"),
    source("src/lib/commerce/server.ts"),
    source("src/components/admin/owner/OwnerDashboard.tsx"),
  ]);

  assert.match(legacyMigration, /insert into public\.member_accounts/);
  assert.match(
    roleContractRepair,
    /roles\.role_code = 'member'[\s\S]*public\.is_owner_hidden_test_member\(roles\.user_id\)[\s\S]*then 'member'/,
  );
  assert.match(
    creditRepair,
    /on conflict \(member_id\) do update[\s\S]*shipping_credit_count = excluded\.shipping_credit_count[\s\S]*account_status = excluded\.account_status/,
  );
  assert.match(
    roleContractRepair,
    /v_is_hidden_test[\s\S]*new\.role_code <> 'member'[\s\S]*not v_is_hidden_test[\s\S]*auth_user_has_kakao_identity/,
  );
  assert.match(retirement, /select false/);
  assert.match(retirement, /revoke insert, update, delete on public\.owner_member_mode_sessions/);
  assert.match(
    retirement,
    /current_access_role\(\) = 'member'[\s\S]*is_owner_hidden_test_member\(auth\.uid\(\)\)/,
  );
  assert.match(
    checkoutEligibility,
    /v_is_production_test_member := public\.is_owner_hidden_test_member\(v_user_id\)/,
  );
  assert.match(
    checkoutEligibility,
    /not public\.auth_user_has_kakao_identity\(v_user_id\)[\s\S]*not v_is_production_test_member/,
  );
  assert.match(testMemberRoute, /signInProductionTestMember/);
  assert.match(testMemberServer, /signInWithPassword/);
  assert.match(testMemberServer, /isProductionTestMember/);
  assert.match(testMemberRoute, /enforceTestMemberLoginRateLimit/);
  assert.match(testMemberPage, /index: false/);
  assert.match(ownerMemberAccessRoute, /authenticateOwnerAccessRequest\(request\)/);
  assert.match(ownerMemberAccessRoute, /PRODUCTION_TEST_MEMBER_PASSWORD/);
  assert.match(ownerMemberAccessRoute, /signInProductionTestMember/);
  assert.match(ownerMemberAccessRoute, /get_owner_hidden_test_member/);
  assert.match(ownerMemberAccessRoute, /owner_record_hidden_test_member_session_access/);
  assert.match(ownerMemberAccessPanel, /회원으로 접속/);
  assert.match(ownerMemberAccessPanel, /storeOwnerMemberAccessMarker/);
  assert.match(ownerReturnControl, /소유자 복귀/);
  assert.match(ownerReturnControl, /auth\.signOut\(\{[\s\S]*scope: "local"/);
  assert.match(ownerReturnControl, /api\/auth\/kakao\/start/);
  assert.match(sessionAccessMigration, /security definer[\s\S]*set search_path = ''/);
  assert.match(sessionAccessMigration, /roles\.role_code = 'member'/);
  assert.match(sessionAccessMigration, /test_members\.owner_id = v_owner_id/);
  assert.match(sessionAccessMigration, /effective_member_account_status\(accounts\.member_id\) = 'active'/);
  assert.match(sessionAccessMigration, /test_member\.session_accessed/);
  assert.match(sessionAccessMigration, /revoke all[\s\S]*from public, anon, service_role/);
  assert.match(sessionAccessMigration, /grant execute[\s\S]*to authenticated/);
  assert.match(clientAuth, /isProductionTestMember\(user\)/);
  assert.doesNotMatch(serverAuth, /getOwnerMemberModeState|member_mode_active/);
  assert.doesNotMatch(dashboard, /회원 화면 임시 확인|3분간 회원 권한 활성화/);
});

test("brand choices are derived from the complete registered-product catalog", async () => {
  const feed = await source(
    "src/components/features/auction/AuctionFeedGrid.tsx",
  );

  assert.doesNotMatch(feed, /input\.query/);
  assert.match(feed, /cards\.map\(\(card\) => card\.brand\.trim\(\)\)\.filter\(Boolean\)/);
  assert.match(feed, /brands: brandOptions\.filter/);
});
