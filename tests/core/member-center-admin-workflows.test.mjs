import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("first-login nickname setup is limited to Kakao account hubs and every later change is reviewed", async () => {
  const [layout, desktopAccount, mobileAccount, mobileSettings, gate, settings, review, migration] = await Promise.all([
    source("src/app/layout.tsx"),
    source("src/app/(shop)/my/page.tsx"),
    source("src/app/(mobile)/m/account/page.tsx"),
    source("src/app/(mobile)/m/settings/page.tsx"),
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
  assert.match(settings, /<PremiumDialog/);
  assert.match(settings, /placement="sheet-bottom"/);
  assert.match(settings, /닉네임 설정을 표시하지 못했습니다/);
  assert.match(mobileAccount, /<NicknameSettings presentation="modal"\s*\/>/);
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

test("band member runtime is retired and combined payments enforce the visible deadline", async () => {
  const [migration, policyMigration, route, combinedPayment, authTypes] = await Promise.all([
    source("supabase/migrations/20260723043642_member_center_admin_workflows.sql"),
    source("supabase/migrations/20260826231224_harden_live_auction_policy_v2.sql"),
    source("src/app/api/payments/manual-transfer/route.ts"),
    source("src/components/features/account/CombinedAuctionPayment.tsx"),
    source("src/lib/supabase/auth.ts"),
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
  assert.match(policyMigration, /set role_code = 'member'[\s\S]*where role_code = 'band_member'/i);
  assert.match(policyMigration, /role_code in \('owner', 'operator', 'employee', 'member'\)/i);
  assert.doesNotMatch(route, /band_member/);
  assert.match(route, /deadlineEnforcementExempt:\s*false/);
  assert.doesNotMatch(authTypes, /band_member/);
  assert.match(route, /begin_my_combined_auction_payment/);
  assert.match(combinedPayment, /paymentBlocked/);
  assert.match(combinedPayment, /deadlineEnforcementExempt/);
  assert.match(combinedPayment, /가장 빠른 결제 마감/);
  assert.match(combinedPayment, /선택 상품 결제하기/);
});

test("employee and operator navigation use storage and one-step shipping without intake management", async () => {
  await Promise.all([
    access(new URL("src/app/(admin)/admin/employee/inquiries/page.tsx", rootUrl)),
    access(new URL("src/app/(admin)/admin/employee/parcels/page.tsx", rootUrl)),
    access(new URL("src/app/(admin)/admin/operator/chat/page.tsx", rootUrl)),
  ]);
  for (const path of [
    "src/app/(admin)/admin/employee/fulfillment/page.tsx",
    "src/app/(admin)/admin/employee/center/page.tsx",
    "src/app/(admin)/admin/operator/center/page.tsx",
  ]) {
    await assert.rejects(access(new URL(path, rootUrl)));
  }
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
  assert.match(employeeLayout, /title="직원센터"/);
  for (const route of ["inquiries", "parcels"]) {
    assert.match(employeeLayout, new RegExp(`/admin/employee/${route}`));
  }
  assert.doesNotMatch(employeeLayout, /\/admin\/employee\/fulfillment/);
  assert.doesNotMatch(employeeLayout, /\/admin\/employee\/center/);
  assert.doesNotMatch(operatorLayout, /\/admin\/operator\/center/);
  assert.match(operatorLayout, /상품 등록부터 배송과 정산까지/);
  assert.doesNotMatch(operatorLayout, /\/admin\/operator\/payments/);
  assert.match(operatorLayout, /\/admin\/operator\/platform/);
  assert.doesNotMatch(operatorLayout, /\/admin\/operator\/members/);
  assert.match(operatorLayout, /\/admin\/operator\/sales/);
  assert.match(operatorLayout, /\/admin\/operator\/community/);
  assert.match(
    header,
    /href: "\/admin\/operator", label: "업무"/,
  );
  assert.match(header, /href: "\/admin\/employee", label: "업무"/);
  assert.match(header, /UserMenuDropdown/);
});

test("retired center management is gone and product control uses explicit store membership", async () => {
  const [productRoute, pauseRoute, migration] =
    await Promise.all([
      source("src/app/api/admin/operator/products/route.ts"),
      source("src/app/api/admin/operator/products/[id]/pause/route.ts"),
      source("supabase/migrations/20260723043642_member_center_admin_workflows.sql"),
    ]);

  assert.match(productRoute, /from\("store_memberships"\)/);
  assert.doesNotMatch(productRoute, /fulfillment_center_staff_assignments|home_fulfillment_center_id/);
  assert.match(pauseRoute, /"pause_managed_product"/);
  assert.match(
    migration,
    /access_role_for_user\(auth\.uid\(\)\) = 'operator'[\s\S]*'manage_products', 'publish_products'/i,
  );
  assert.match(migration, /function public\.pause_managed_product/i);
  assert.match(migration, /v_product\.status <> 'active'/i);
});

test("payment confirmation is owner-only and the operator order page mounts the scoped ledger", async () => {
  const [layout, route, consoleSource, redirectPage] = await Promise.all([
    source("src/app/(admin)/admin/operator/layout.tsx"),
    source("src/app/api/admin/operator/payments/route.ts"),
    source("src/components/admin/operator/OperatorPaymentsConsole.tsx"),
    source("src/app/(admin)/admin/operator/orders/page.tsx"),
  ]);

  assert.doesNotMatch(layout, /label:\s*"주문·입금"/);
  assert.match(redirectPage, /<OperatorOrdersConsole\s*\/>/);
  assert.match(route, /auth\.roleCode !== "owner"/);
  assert.match(route, /from\("profiles"\)/);
  assert.match(route, /from\("commerce_order_items"\)/);
  assert.match(route, /from\("manual_transfer_orders"\)/);
  assert.match(route, /buyerName:/);
  assert.match(route, /products:/);
  assert.match(consoleSource, /payment\.buyerName/);
  assert.match(consoleSource, /productSummary/);
  assert.match(consoleSource, /상세보기/);
  assert.match(consoleSource, /selectedPayment\.products\.map/);
  assert.match(consoleSource, /ariaLabel="입금 확인 상세보기"/);
  assert.match(consoleSource, /onClick=\{\(\) => openPaymentDetails\(payment\)\}/);
  assert.match(consoleSource, /void confirm\(selectedPayment\)/);
  assert.match(consoleSource, /내용 확인 후 입금 확인 완료/);
});

test("owner save paths use user-scoped persistence while center topology is retired", async () => {
  const [siteRoute, memberRoute, migration] =
    await Promise.all([
      source("src/app/api/admin/owner/site-status/route.ts"),
      source("src/app/api/admin/owner/members/route.ts"),
      source("supabase/migrations/20260723043642_member_center_admin_workflows.sql"),
    ]);

  assert.match(siteRoute, /access\.userClient\.rpc\("set_site_status"/);
  assert.doesNotMatch(siteRoute, /\.from\("site_status"\)[\s\S]*\.upsert\(/);
  assert.match(memberRoute, /access\.userClient\.rpc\("set_managed_staff_role"/);
  assert.match(memberRoute, /p_reports_to_operator_id:\s*reportsToOperatorId/);
  assert.doesNotMatch(memberRoute, /p_display_name:\s*body/);
  assert.match(migration, /v_role not in \('operator', 'employee', 'band_member', 'member'\)/);
  assert.match(migration, /function public\.set_site_status/i);
  assert.match(migration, /function public\.set_managed_staff_role/i);
});
