import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

const migrationPath =
  "supabase/migrations/20260723120000_owner_operator_member_fulfillment_checkout.sql";

test("owner nickname and member management cover self-edit, separated states, enforcement reset, and safe purge", async () => {
  const [migration, route, consoleSource] = await Promise.all([
    source(migrationPath),
    source("src/app/api/admin/owner/members/route.ts"),
    source("src/components/admin/owner/OwnerMembersConsole.tsx"),
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
  assert.match(migration, /function public\.purge_deleted_member_record/i);
  assert.match(
    migration,
    /exception[\s\S]*when foreign_key_violation[\s\S]*거래 또는 감사 이력/i,
  );
  assert.match(route, /action === "enforcement_clear"/);
  assert.match(route, /action === "purge"/);
  assert.match(route, /"purge_deleted_member_record"/);
  for (const label of ["전체", "활성", "정지", "탈퇴"]) {
    assert.match(consoleSource, new RegExp(`:\\s*"${label}"`));
  }
  assert.match(consoleSource, /경고 누적 삭제/);
  assert.match(consoleSource, /제재 누적 삭제/);
  assert.match(consoleSource, /완전 삭제/);
  assert.match(consoleSource, /member\.access_role === "owner"/);
  assert.doesNotMatch(consoleSource, /disabled=\{member\.access_role === "owner"\}/);
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
