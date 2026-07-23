import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

const migrationPath =
  "supabase/migrations/20260723120000_owner_operator_member_fulfillment_checkout.sql";
const retentionMigrationPath =
  "supabase/migrations/20260723130000_owner_member_management_retention.sql";
const profileLedgerMigrationPath =
  "supabase/migrations/20260723140000_link_profiles_to_ledger_principals.sql";

test("owner member management actions use confirmed reasons and separate seven-day withdrawn retention", async () => {
  const [
    migration,
    retentionMigration,
    profileLedgerMigration,
    route,
    archiveRoute,
    consoleSource,
    archiveConsole,
  ] = await Promise.all([
    source(migrationPath),
    source(retentionMigrationPath),
    source(profileLedgerMigrationPath),
    source("src/app/api/admin/owner/members/route.ts"),
    source("src/app/api/admin/owner/members/withdrawn/route.ts"),
    source("src/components/admin/owner/OwnerMembersConsole.tsx"),
    source("src/components/admin/owner/WithdrawnMembersConsole.tsx"),
  ]);

  assert.match(
    migration,
    /set_my_initial_nickname[\s\S]*not in \('owner', 'operator', 'employee', 'band_member', 'member'\)/i,
  );
  assert.match(
    migration,
    /update_managed_member[\s\S]*v_role not in \('owner', 'operator', 'employee', 'band_member', 'member'\)/i,
  );
  assert.match(migration, /function public\.clear_member_enforcement_history/i);
  assert.match(migration, /delete from public\.member_warnings/i);
  assert.match(migration, /delete from public\.member_bid_sanctions/i);
  assert.match(
    retentionMigration,
    /function public\.set_managed_member_status[\s\S]*target_role = 'owner'/i,
  );
  assert.match(
    retentionMigration,
    /function public\.create_member_24_hour_sanction[\s\S]*started_at \+ interval '24 hours'/i,
  );
  assert.match(
    retentionMigration,
    /create table app_private\.withdrawn_member_retention[\s\S]*purge_due_at = deleted_at \+ interval '7 days'/i,
  );
  assert.match(
    retentionMigration,
    /profiles[\s\S]*auth\.users[\s\S]*ledger_principals[\s\S]*연쇄 삭제 연결/i,
  );
  assert.match(
    profileLedgerMigration,
    /alter table public\.profiles[\s\S]*foreign key \(id\)[\s\S]*references app_private\.ledger_principals\(id\)/i,
  );
  assert.match(
    retentionMigration,
    /get_manager_member_directory[\s\S]*profiles\.deleted_at is null[\s\S]*accounts\.account_status <> 'deleted'/i,
  );
  assert.match(
    retentionMigration,
    /withdrawn-member-retention-cleanup[\s\S]*17 \* \* \* \*/i,
  );
  assert.match(route, /action === "enforcement_clear"/);
  assert.match(route, /action === "status"/);
  assert.match(route, /action === "warning"/);
  assert.match(route, /action === "sanction_create"/);
  assert.match(route, /"create_member_24_hour_sanction"/);
  assert.match(route, /action === "delete"/);
  assert.match(route, /normalizeManagementReason/);
  assert.match(archiveRoute, /"get_owner_withdrawn_member_retention"/);
  assert.match(archiveRoute, /"retry_withdrawn_member_cleanup"/);
  for (const label of ["전체", "활성", "정지"]) {
    assert.match(consoleSource, new RegExp(`:\\s*"${label}"`));
  }
  assert.doesNotMatch(consoleSource, /:\\s*"탈퇴"/);
  for (const label of ["활성", "정지", "일시 정지", "경고"]) {
    assert.match(consoleSource, new RegExp(`>\\s*${label}\\s*<`));
  }
  assert.match(consoleSource, /24시간 제재/);
  assert.match(consoleSource, /경고 누적 삭제/);
  assert.match(consoleSource, /제재 누적 삭제/);
  assert.match(consoleSource, /탈퇴 보관함/);
  assert.match(consoleSource, /role="dialog"/);
  assert.match(consoleSource, /처리 사유/);
  assert.match(consoleSource, /member\.access_role === "owner"/);
  assert.match(consoleSource, /소유자 계정은[\s\S]*정지·제재·탈퇴/);
  assert.match(archiveConsole, /익명 회원/);
  assert.match(archiveConsole, /정리 재시도/);
  assert.doesNotMatch(archiveConsole, /member\.email|member\.phone|legal_name/);
});

test("center assignments derive capabilities from operator and employee roles and can be edited or deleted", async () => {
  const [migration, route, consoleSource, centerRoute, centerConsole] =
    await Promise.all([
      source(migrationPath),
      source("src/app/api/admin/owner/fulfillment/route.ts"),
      source(
        "src/app/(admin)/admin/owner/fulfillment/OwnerFulfillmentConsole.tsx",
      ),
      source("src/app/api/admin/centers/route.ts"),
      source("src/components/admin/center/StaffCenterManagementConsole.tsx"),
    ]);

  assert.match(
    migration,
    /configure_fulfillment_center_staff_assignment[\s\S]*roles\.role_code in \('operator', 'employee'\)/i,
  );
  assert.match(
    migration,
    /receive_at_center,\s*create_shipments[\s\S]*true,\s*true/i,
  );
  assert.match(migration, /function public\.delete_fulfillment_center_staff_assignment/i);
  assert.match(
    migration,
    /delete from public\.fulfillment_center_staff_assignments as assignments[\s\S]*where not exists[\s\S]*roles\.role_code in \('operator', 'employee'\)/i,
  );
  assert.match(route, /action === "delete_assignment"/);
  assert.match(route, /p_receive_at_center:\s*true/);
  assert.match(route, /p_create_shipments:\s*true/);
  assert.match(consoleSource, /역할에서 자동 결정/);
  assert.match(consoleSource, /센터 배정을 삭제/);
  assert.doesNotMatch(consoleSource, /assignmentReceive|assignmentShip/);
  assert.match(centerRoute, /body\.action === "configure_store_route"/);
  assert.match(centerRoute, /"configure_store_fulfillment_route"/);
  assert.match(centerConsole, /각 매장별 센터 연결/);
});

test("every operator can confirm shared payments while owner retains site and refund authority", async () => {
  const [migration, ownerLayout, operatorLayout] = await Promise.all([
    source(migrationPath),
    source("src/app/(admin)/admin/owner/layout.tsx"),
    source("src/app/(admin)/admin/operator/layout.tsx"),
  ]);

  assert.match(
    migration,
    /can_confirm_shared_payment[\s\S]*access_role_for_user\(auth\.uid\(\)\) in \('owner', 'operator'\)/i,
  );
  assert.match(ownerLayout, /사이트·로그/);
  assert.match(ownerLayout, /회원·권한/);
  assert.match(ownerLayout, /센터·매장 구조/);
  assert.match(ownerLayout, /환불 승인/);
  assert.doesNotMatch(ownerLayout, /배송·결제/);
  assert.match(operatorLayout, /주문·입금 확인/);
  assert.match(operatorLayout, /택배·송장/);
});

test("checkout quotes shipping per business, defaults to paying it, and projects a one-use entitlement after payment", async () => {
  const [migration, cartRoute, checkoutRoute, cartView] = await Promise.all([
    source(migrationPath),
    source("src/app/api/cart/route.ts"),
    source("src/app/api/orders/checkout/route.ts"),
    source("src/components/features/commerce/CartView.tsx"),
  ]);

  assert.match(migration, /create table public\.commerce_order_shipping_fee_allocations/i);
  assert.match(migration, /p_include_shipping_fee boolean/i);
  assert.match(migration, /apply_commerce_checkout_shipping_fee/i);
  assert.match(migration, /project_prepaid_shipping_entitlements/i);
  assert.match(
    migration,
    /new\.status in \('paid', 'shipped'\)[\s\S]*insert into public\.shipping_fee_waiver_entitlements/i,
  );
  assert.match(cartRoute, /shipping_fee_amount/);
  assert.match(cartRoute, /shippingFee/);
  assert.match(checkoutRoute, /p_include_shipping_fee:\s*includeShippingFee/);
  assert.match(cartView, /useState\(true\)/);
  assert.match(cartView, /배송비 함께 결제/);
  assert.match(cartView, /includeShippingFee:\s*currentRequest\.includeShippingFee/);
  assert.match(
    cartView,
    /productTotal \+ \(includeShippingFee \? shippingFee : 0\)/,
  );
});
