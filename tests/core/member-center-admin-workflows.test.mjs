import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("first-login nickname setup is limited to Kakao account hubs and every later change is reviewed", async () => {
  const [layout, desktopAccount, mobileAccount, mobileSettings, gate, settings, review, migration] = await Promise.all([
    source("src/app/layout.tsx"),
    source("src/app/(shop)/account/page.tsx"),
    source("src/app/(mobile)/m/account/page.tsx"),
    source("src/app/(mobile)/m/account/settings/page.tsx"),
    source("src/components/account/NicknameGate.tsx"),
    source("src/components/account/NicknameSettings.tsx"),
    source("src/components/admin/owner/OwnerNicknameReviewPanel.tsx"),
    source("supabase/migrations/20260723043642_member_center_admin_workflows.sql"),
  ]);

  assert.doesNotMatch(layout, /NicknameGate/);
  assert.match(desktopAccount, /<NicknameGate\s*\/>/);
  assert.match(mobileAccount, /<NicknameGate\s*\/>/);
  assert.doesNotMatch(mobileSettings, /NicknameGate/);
  assert.match(gate, /identity\.provider === "kakao"/);
  assert.match(gate, /if \(loading \|\| !kakaoUserId\)/);
  assert.match(gate, /loadedUserId !== kakaoUserId/);
  assert.match(gate, /state\?\.isInitialized !== false/);
  assert.match(gate, /setMyInitialNickname\(nickname\)/);
  assert.doesNotMatch(gate, /onClose|dismiss|닫기/);
  assert.match(settings, /requestMyNicknameChange\(nickname\)/);
  assert.match(settings, /운영자 승인이 필요/);
  assert.match(review, /getPendingNicknameChangeRequests/);
  assert.match(review, /reviewNicknameChangeRequest\(request\.id,\s*approve\)/);
  assert.match(migration, /drop function if exists public\.change_my_nickname_once\(text\)/i);
  assert.match(
    migration,
    /function public\.get_my_nickname_state\(\)[\s\S]*false,[\s\S]*pending\.requested_nickname/i,
  );
  assert.match(
    migration,
    /access_role_for_user\(auth\.uid\(\)\) not in \('owner', 'operator'\)/i,
  );
});

test("band members retain a visible deadline but automatic expiry enforcement is disabled", async () => {
  const [migration, route, settlement] = await Promise.all([
    source("supabase/migrations/20260723043642_member_center_admin_workflows.sql"),
    source("src/app/api/payments/manual-transfer/route.ts"),
    source("src/components/features/auction/detail/SettlementActions.tsx"),
  ]);

  assert.match(migration, /display_payment_due_at\s+timestamptz/i);
  assert.match(migration, /display_due_at\s+timestamptz/i);
  assert.match(
    migration,
    /v_category = 'late_payment' and v_target_role = 'band_member'[\s\S]*return query/i,
  );
  assert.match(
    migration,
    /if v_target_role = 'member' and mod\(v_warning_count,\s*3\) = 0/i,
  );
  assert.match(route, /role_code === "band_member"/);
  assert.match(route, /timedOut:/);
  assert.match(settlement, /입금 시간이 초과되었습니다/);
  assert.match(settlement, /지금도 결제할 수 있습니다/);
});

test("employee center and operator center have separate routes and navigation", async () => {
  await Promise.all([
    access(new URL("src/app/(admin)/admin/employee/inquiries/page.tsx", rootUrl)),
    access(new URL("src/app/(admin)/admin/employee/fulfillment/page.tsx", rootUrl)),
    access(new URL("src/app/(admin)/admin/employee/parcels/page.tsx", rootUrl)),
    access(new URL("src/app/(admin)/admin/employee/center/page.tsx", rootUrl)),
    access(new URL("src/app/(admin)/admin/operator/center/page.tsx", rootUrl)),
  ]);
  const [session, boundary, employeeLayout, operatorLayout, header] =
    await Promise.all([
      source("src/app/api/admin/session/route.ts"),
      source("src/components/admin/AdminAccessBoundary.tsx"),
      source("src/app/(admin)/admin/employee/layout.tsx"),
      source("src/app/(admin)/admin/operator/layout.tsx"),
      source("src/components/layout/AuthStatus.tsx"),
    ]);

  assert.match(session, /canAccessOperator = isOwner \|\| roleCode === "operator"/);
  assert.match(session, /canAccessEmployee = isOwner \|\| roleCode === "employee"/);
  assert.match(boundary, /pathname\.startsWith\("\/admin\/employee\/"\)/);
  assert.match(employeeLayout, /직원센터 메뉴/);
  for (const route of ["inquiries", "fulfillment", "parcels", "center"]) {
    assert.match(employeeLayout, new RegExp(`/admin/employee/${route}`));
  }
  assert.match(operatorLayout, /\/admin\/operator\/center/);
  assert.match(operatorLayout, /\/admin\/operator\/payments/);
  assert.doesNotMatch(operatorLayout, /\/admin\/operator\/members/);
  assert.doesNotMatch(operatorLayout, /\/admin\/operator\/chat/);
  assert.match(header, /label: "센터 관리"/);
  assert.match(header, /label: "직원센터"/);
});

test("assigned center management and center-wide product control use guarded RPCs", async () => {
  const [centerRoute, centerConsole, productRoute, pauseRoute, migration] =
    await Promise.all([
      source("src/app/api/admin/centers/route.ts"),
      source("src/components/admin/center/StaffCenterManagementConsole.tsx"),
      source("src/app/api/admin/operator/products/route.ts"),
      source("src/app/api/admin/operator/products/[id]/pause/route.ts"),
      source("supabase/migrations/20260723043642_member_center_admin_workflows.sql"),
    ]);

  assert.match(centerRoute, /"get_my_center_management"/);
  assert.match(centerRoute, /"configure_assigned_fulfillment_center"/);
  assert.match(centerConsole, /action:\s*"create"\s*\|\s*"update"\s*\|\s*"archive"/);
  assert.match(centerConsole, /센터 추가/);
  assert.match(centerConsole, /센터 정보를 저장했습니다/);
  assert.match(productRoute, /fulfillment_center_staff_assignments/);
  assert.match(productRoute, /home_fulfillment_center_id/);
  assert.match(pauseRoute, /"pause_managed_product"/);
  assert.match(
    migration,
    /access_role_for_user\(auth\.uid\(\)\) = 'operator'[\s\S]*'manage_products', 'publish_products'/i,
  );
  assert.match(migration, /function public\.pause_managed_product/i);
  assert.match(migration, /v_product\.status <> 'active'/i);
});

test("orders and payment confirmation are buyer-grouped with linked products", async () => {
  const [layout, route, consoleSource, redirectPage] = await Promise.all([
    source("src/app/(admin)/admin/operator/layout.tsx"),
    source("src/app/api/admin/operator/payments/route.ts"),
    source("src/components/admin/operator/OperatorPaymentsConsole.tsx"),
    source("src/app/(admin)/admin/operator/orders/page.tsx"),
  ]);

  assert.match(layout, /주문·입금 확인/);
  assert.match(redirectPage, /redirect\("\/admin\/operator\/payments"\)/);
  assert.match(route, /from\("profiles"\)/);
  assert.match(route, /from\("commerce_order_items"\)/);
  assert.match(route, /from\("manual_transfer_orders"\)/);
  assert.match(route, /buyerName:/);
  assert.match(route, /products:/);
  assert.match(consoleSource, /const buyerGroups = useMemo/);
  assert.match(consoleSource, /group\.buyerName/);
  assert.match(consoleSource, /payment\.products\.map/);
  assert.match(consoleSource, /void confirm\(payment\)/);
});

test("owner save paths use user-scoped persistence RPCs", async () => {
  const [siteRoute, memberRoute, ownerCenterRoute, migration] =
    await Promise.all([
      source("src/app/api/admin/owner/site-status/route.ts"),
      source("src/app/api/admin/owner/members/route.ts"),
      source("src/app/api/admin/owner/fulfillment/route.ts"),
      source("supabase/migrations/20260723043642_member_center_admin_workflows.sql"),
    ]);

  assert.match(siteRoute, /access\.userClient\.rpc\("set_site_status"/);
  assert.doesNotMatch(siteRoute, /\.from\("site_status"\)[\s\S]*\.upsert\(/);
  assert.match(memberRoute, /access\.userClient\.rpc\("set_managed_staff_role"/);
  assert.match(memberRoute, /p_reports_to_operator_id:\s*reportsToOperatorId/);
  assert.doesNotMatch(memberRoute, /p_display_name:\s*body/);
  assert.match(migration, /v_role not in \('operator', 'employee', 'band_member', 'member'\)/);
  assert.match(ownerCenterRoute, /"configure_managed_fulfillment_center"/);
  assert.match(ownerCenterRoute, /"configure_fulfillment_center_staff_assignment"/);
  assert.match(migration, /function public\.set_site_status/i);
  assert.match(migration, /function public\.set_managed_staff_role/i);
});
