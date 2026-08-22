import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("member checkout defaults to shipping and keeps payment and deposit-info dialogs separate", async () => {
  const [cart, combined, route, migration] = await Promise.all([
    source("src/components/features/commerce/CartView.tsx"),
    source("src/components/features/account/CombinedAuctionPayment.tsx"),
    source("src/app/api/payments/manual-transfer/route.ts"),
    source("supabase/migrations/20260724050537_member_shipping_payment_and_storage_experience.sql"),
  ]);

  assert.match(cart, /useState\(true\)/);
  assert.match(cart, /includeShippingFee/);
  assert.match(combined, /useState\(true\)/);
  assert.match(combined, />택배비 포함 결제</);
  assert.match(combined, /includeShippingFee/);
  assert.doesNotMatch(combined, /shippingCreditQuantity/);
  assert.match(combined, /입금 정보 보기/);
  assert.match(combined, /입금자명 수정하기/);
  assert.match(combined, /결제하기/);
  assert.match(combined, /setDialog\(null\)/);
  assert.match(combined, /dialog === "info"/);
  assert.match(combined, /\+택배비/);
  assert.match(combined, /총 결제 금액/);
  assert.match(route, /p_include_shipping_fee:\s*body\.includeShippingFee !== false/);
  assert.match(migration, /p_include_shipping_fee boolean default true/i);
  assert.match(migration, /inventory_fulfillment_rollout_settings/i);
  assert.match(migration, /payment_context = 'auction_bundle'/i);
  assert.match(migration, /shipping_credit_count = shipping_credit_count \+ v_bundle\.credit_quantity/i);
  assert.match(migration, /expectedAmount'[\s\S]*v_shipping_fee/i);
  assert.match(
    migration,
    /grant select on table public\.inventory_fulfillment_rollout_settings\s+to service_role/i,
  );
});

test("standalone shipping credits are retired while historical ledger contracts remain", async () => {
  const [route, dashboard, migration] = await Promise.all([
    source("src/app/api/shipping/credits/route.ts"),
    source("src/components/features/account/AccountDashboard.tsx"),
    source("supabase/migrations/20260724050537_member_shipping_payment_and_storage_experience.sql"),
  ]);

  assert.match(route, /shipping_credit_retired/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /410/);
  assert.doesNotMatch(dashboard, /필요한 크레딧 수량|requestShippingCredits|입금 확인 후 적립/);
  assert.match(migration, /add column credit_quantity integer not null default 1/i);
  assert.match(migration, /confirm_prepaid_shipping_credit_payment/i);
  assert.match(
    migration,
    /'배송 크레딧 '\s*\|\|\s*payments\.credit_quantity::text\s*\|\|\s*'개'/i,
  );
  assert.match(migration, /payment_context = 'shipping_credit'/i);
  assert.match(migration, /shipping_credit_count \+ v_payment\.credit_quantity - 1/i);
  assert.match(migration, /shipping_credit_count - \(v_payment\.credit_quantity - 1\)/i);
});

test("member addresses use the owner-safe RPC and storage shows policy, full list, and item selection", async () => {
  const [addressRoute, storageRoute, ordersRoute, dashboard, cart, accountPage, accountContent, accountSectionPage, rollout, serverGrant] = await Promise.all([
    source("src/app/api/account/addresses/route.ts"),
    source("src/app/api/account/storage/route.ts"),
    source("src/app/api/orders/route.ts"),
    source("src/components/features/account/AccountDashboard.tsx"),
    source("src/components/features/commerce/CartView.tsx"),
    source("src/app/(shop)/account/page.tsx"),
    source("src/components/features/mypage/MyDashboard.tsx"),
    source("src/app/(shop)/account/[section]/page.tsx"),
    source("supabase/migrations/20260724054224_enable_selectable_paid_inventory.sql"),
    source("supabase/migrations/20260724061006_grant_inventory_server_read.sql"),
  ]);

  assert.match(addressRoute, /\.rpc\("upsert_my_shipping_address"/);
  assert.match(addressRoute, /p_id:\s*addressId/);
  assert.doesNotMatch(addressRoute, /p_id:\s*addressId\s*\?\?\s*crypto\.randomUUID\(\)/);
  assert.doesNotMatch(addressRoute, /\.from\("shipping_addresses"\)\.insert/);
  assert.match(addressRoute, /5자리 우편번호/);
  assert.match(storageRoute, /storage_class_snapshot,\s*storage_duration_days/);
  assert.match(storageRoute, /storageDurationDays/);
  assert.match(storageRoute, /storage_expires_at/);
  assert.match(storageRoute, /function hasRequiredKeys/);
  assert.doesNotMatch(storageRoute, /function hasExactKeys/);
  assert.match(ordersRoute, /storage_class/);
  assert.match(dashboard, /소형 2주, 대형 1주/);
  assert.match(dashboard, /"전체보기"/);
  assert.match(dashboard, /배송 가능 상품 전체 선택/);
  assert.match(dashboard, /aria-label=\{`\$\{item\.title\} 배송 선택`\}/);
  assert.match(dashboard, /우편번호 5자리/);
  assert.match(dashboard, /배송지를 저장하고 선택했습니다/);
  assert.match(dashboard, /지금 처리해야 할 항목/);
  assert.match(dashboard, /배송지 추가 \/ 수정 \/ 삭제/);
  assert.match(addressRoute, /export async function PATCH/);
  assert.match(addressRoute, /export async function DELETE/);
  assert.match(cart, /배송지 추가하고 선택/);
  assert.match(cart, /saveCheckoutAddress/);
  assert.match(cart, /deleteCheckoutAddress/);
  assert.match(cart, /name="checkout-shipping-address"/);
  assert.match(cart, /배송지 선택/);
  assert.match(dashboard, /col-start-2 row-start-1[\s\S]*id="storage"/);
  assert.match(dashboard, /col-start-1 row-start-1[\s\S]*id="shipping-request"/);
  assert.doesNotMatch(dashboard, /id="shipping-credit"/);
  assert.match(dashboard, /<details[^>]*id="refunds"/);
  assert.match(
    dashboard,
    /<details[^>]*id="refunds"[^>]*open=\{view === "refunds" \? true : undefined\}/,
  );
  assert.doesNotMatch(dashboard, /<details[^>]*id="refunds"[^>]*open=\{true\}/);
  assert.match(accountPage, /redirect\("\/my"\)/);
  assert.match(accountContent, /homeOnly onNavigate/);
  assert.match(accountContent, /MY 대시보드 메뉴/);
  assert.match(accountContent, /homeOnly/);
  assert.match(accountContent, /label:"홈"/);
  assert.match(accountContent, /aria-label="MY 대시보드 메뉴"/);
  assert.match(accountContent, /initialTab/);
  assert.match(accountContent, /주문·배송/);
  assert.match(accountContent, /보관함/);
  assert.match(dashboard, /배송 상담/);
  assert.match(dashboard, /openShippingRequest/);
  assert.doesNotMatch(accountContent, /role="dialog"/);
  assert.doesNotMatch(accountContent, /window\.history\.pushState/);
  assert.match(accountSectionPage, /redirect\("\/my\/vault"\)/);
  assert.match(accountContent, /<BidHistory basePath=\{basePath\}/);
  assert.match(rollout, /create_customer_inventory_entitlement\(\s*'auction'/i);
  assert.match(rollout, /current_stage = 'reconciliation_required'/i);
  assert.match(rollout, /current_stage = 'preparing'/i);
  assert.match(rollout, /item_selected_shipments_enabled = true/i);
  assert.match(
    serverGrant,
    /grant select on table public\.customer_inventory_items to service_role/i,
  );
});

test("direct-store cutover projects paid items without reactivating the retired center workflow", async () => {
  const repair = await source(
    "supabase/migrations/20260724185954_repair_direct_store_inventory_projection.sql",
  );

  assert.match(
    repair,
    /create or replace function app_private\.create_customer_inventory_entitlement/,
  );
  assert.match(repair, /routes\.status = 'active'/);
  assert.match(repair, /centers\.business_id = v_business/);
  assert.doesNotMatch(
    repair,
    /centers\.status = 'active'/,
  );
  assert.match(repair, /'direct_store_entitlement'/);
  assert.match(
    repair,
    /create_customer_inventory_entitlement\(\s*'auction'/i,
  );
  assert.match(
    repair,
    /current_stage = 'reconciliation_required'[\s\S]*current_stage = 'preparing'/,
  );
  assert.match(
    repair,
    /unified_inventory_reads_enabled = true[\s\S]*item_selected_shipments_enabled = true/,
  );
  assert.doesNotMatch(repair, /update public\.fulfillment_centers[\s\S]*status/);
});
