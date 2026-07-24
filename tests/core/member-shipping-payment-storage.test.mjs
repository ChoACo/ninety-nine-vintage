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

test("shipping credits accept an explicit quantity and remain one payment request", async () => {
  const [route, dashboard, migration] = await Promise.all([
    source("src/app/api/shipping/credits/route.ts"),
    source("src/components/features/account/AccountDashboard.tsx"),
    source("supabase/migrations/20260724050537_member_shipping_payment_and_storage_experience.sql"),
  ]);

  assert.match(route, /quantity < 1 \|\|[\s\S]*quantity > 20/);
  assert.match(route, /request_my_shipping_credit_payment/);
  assert.match(route, /p_depositor_name:\s*depositorName/);
  assert.match(route, /cancel_my_shipping_credit_payment/);
  assert.match(route, /method: "DELETE"|export async function DELETE/);
  assert.match(dashboard, /필요한 크레딧 수량/);
  assert.match(dashboard, /requestShippingCredits/);
  assert.match(dashboard, /입금 확인 후 적립/);
  assert.match(dashboard, /입금자명 확인/);
  assert.match(dashboard, /신청 취소/);
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
  const [addressRoute, storageRoute, ordersRoute, dashboard, accountPage, rollout, serverGrant] = await Promise.all([
    source("src/app/api/account/addresses/route.ts"),
    source("src/app/api/account/storage/route.ts"),
    source("src/app/api/orders/route.ts"),
    source("src/components/features/account/AccountDashboard.tsx"),
    source("src/app/(shop)/account/page.tsx"),
    source("supabase/migrations/20260724054224_enable_selectable_paid_inventory.sql"),
    source("supabase/migrations/20260724061006_grant_inventory_server_read.sql"),
  ]);

  assert.match(addressRoute, /\.rpc\("upsert_my_shipping_address"/);
  assert.doesNotMatch(addressRoute, /\.from\("shipping_addresses"\)\.insert/);
  assert.match(addressRoute, /5자리 우편번호/);
  assert.match(storageRoute, /storage_class_snapshot,\s*storage_duration_days/);
  assert.match(storageRoute, /storageDurationDays/);
  assert.match(storageRoute, /storage_expires_at/);
  assert.match(ordersRoute, /storage_class/);
  assert.match(dashboard, /소형 2주, 대형 1주/);
  assert.match(dashboard, /"전체보기"/);
  assert.match(dashboard, /배송 가능 상품 전체 선택/);
  assert.match(dashboard, /aria-label=\{`\$\{item\.title\} 배송 선택`\}/);
  assert.match(dashboard, /우편번호 5자리/);
  assert.match(dashboard, /배송지를 저장하고 선택했습니다/);
  assert.match(dashboard, /배송지 추가 \/ 수정 \/ 삭제/);
  assert.match(addressRoute, /export async function PATCH/);
  assert.match(addressRoute, /export async function DELETE/);
  assert.match(dashboard, /col-start-2 row-start-1[\s\S]*id="storage"/);
  assert.match(dashboard, /col-start-1 row-start-1[\s\S]*id="shipping-request"[\s\S]*id="shipping-credit"/);
  assert.match(dashboard, /<details[^>]*id="refunds"/);
  assert.doesNotMatch(dashboard, /<details[^>]*id="refunds"[^>]*\sopen(?:=|\s|>)/);
  assert.match(accountPage, /<details[\s\S]*<BidHistory surface="desktop" \/>[\s\S]*<\/details>/);
  assert.doesNotMatch(accountPage, /<details[^>]*\sopen(?:=|\s|>)/);
  assert.match(rollout, /create_customer_inventory_entitlement\(\s*'auction'/i);
  assert.match(rollout, /current_stage = 'reconciliation_required'/i);
  assert.match(rollout, /current_stage = 'preparing'/i);
  assert.match(rollout, /item_selected_shipments_enabled = true/i);
  assert.match(
    serverGrant,
    /grant select on table public\.customer_inventory_items to service_role/i,
  );
});
