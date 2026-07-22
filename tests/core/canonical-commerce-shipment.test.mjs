import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("historical v1 canonical shipment schema remains immutable compatibility history", async () => {
  const migration = await source(
    "supabase/migrations/20260722060000_add_canonical_commerce_shipments.sql",
  );

  for (const table of [
    "commerce_shipments",
    "commerce_shipment_orders",
    "commerce_shipment_items",
    "commerce_shipment_events",
    "commerce_shipment_reconciliation_cases",
  ]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`, "i"));
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} force row level security`, "i"),
    );
  }
  assert.match(migration, /validate_commerce_shipment_manifest/i);
  assert.match(migration, /commerce_shipments_manifest_complete/i);
  assert.match(migration, /shipping_requests_require_classification/i);
  assert.match(migration, /shipping_fee_payments_one_request_idx/i);
  assert.match(migration, /shipping_credit_ledger_one_request_usage_idx/i);
  assert.match(migration, /commerce_shipment_events_append_only/i);
  assert.match(
    migration,
    /settlement_method = 'shipping_credit'[\s\S]*shipping_credit_ledger_id is not null[\s\S]*shipping_fee_payment_id is null/i,
  );
  assert.match(
    migration,
    /settlement_method = 'manual_transfer'[\s\S]*shipping_fee_payment_id is not null[\s\S]*shipping_credit_ledger_id is null/i,
  );
  assert.match(
    migration,
    /revoke all privileges on table[\s\S]*public\.commerce_shipments[\s\S]*from public, anon, authenticated, service_role/i,
  );
});

test("historical v1 canonical commands retain their complete-order safety contract", async () => {
  const migration = await source(
    "supabase/migrations/20260722070000_activate_canonical_commerce_shipments.sql",
  );

  assert.match(migration, /create or replace function public\.request_commerce_order_shipment/i);
  assert.match(migration, /grant execute on function public\.request_commerce_order_shipment[\s\S]*to service_role/i);
  assert.match(migration, /select count\(\*\)[\s\S]*commerce_shipment_orders[\s\S]*<> 1/i);
  assert.match(migration, /create or replace function public\.pack_commerce_shipment/i);
  assert.match(migration, /p_expected_version bigint/i);
  assert.match(migration, /p_idempotency_key uuid/i);
  assert.match(migration, /v_gate_status <> 'ready_to_pack'/i);
  assert.match(migration, /create or replace function public\.ship_commerce_shipment/i);
  assert.match(migration, /v_gate_status <> 'ready_to_ship'/i);
  assert.match(migration, /commerce_shipments_tracking_key/i);
  assert.match(migration, /create or replace function public\.correct_commerce_shipment_tracking/i);
  assert.match(migration, /not public\.is_owner\(\)/i);
  assert.doesNotMatch(migration, /\bmin\(fulfillment\.business_id\)/i);

  for (const legacyFunction of [
    "request_product_shipping",
    "mark_shipping_request_shipped",
    "upsert_shipping_tracking_batch",
    "get_shipping_work",
    "owner_request_hidden_test_shipping",
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${legacyFunction}`, "i"),
    );
  }
});

test("buyer shipping API keeps exact legacy and v2 paths during staged rollout", async () => {
  const [memberRoute, storageRoute, shipmentHistoryRoute, hiddenTestRoute] =
    await Promise.all([
      source("src/app/api/shipping/requests/route.ts"),
      source("src/app/api/account/storage/route.ts"),
      source("src/app/api/account/shipments/route.ts"),
      source("src/app/api/admin/owner/test-member/shipping/route.ts"),
    ]);

  assert.match(memberRoute, /authenticateMemberCommerceRequest\(request,\s*true\)/);
  assert.match(memberRoute, /auth\.user as unknown as RpcClient/);
  assert.match(memberRoute, /"request_inventory_shipment"/);
  assert.match(memberRoute, /"get_legacy_commerce_shipment_quote"/);
  assert.match(memberRoute, /"request_commerce_order_shipment"/);
  assert.match(memberRoute, /p_member_id:\s*auth\.userId/);
  assert.match(memberRoute, /p_order_id:\s*body\.orderId/);
  assert.match(memberRoute, /p_inventory_item_ids:\s*\[\.\.\.inventoryItemIds\]\.sort\(\)/);
  assert.match(memberRoute, /inventoryItemIds\.length\s*>\s*100/);
  assert.match(memberRoute, /new Set\(inventoryItemIds\)\.size\s*!==\s*inventoryItemIds\.length/);
  assert.match(memberRoute, /p_address_id:\s*body\.addressId/);
  assert.match(memberRoute, /p_settlement_method:\s*settlement/);
  assert.match(memberRoute, /p_idempotency_key:\s*body\.idempotencyKey/);
  assert.match(memberRoute, /LEGACY_BODY_KEYS/);
  assert.match(memberRoute, /V2_BODY_KEYS/);
  assert.match(memberRoute, /hasExactKeys\(body,\s*LEGACY_BODY_KEYS\)/);
  assert.match(memberRoute, /hasExactKeys\(body,\s*V2_BODY_KEYS\)/);
  assert.doesNotMatch(memberRoute, /request_product_shipping/);
  assert.doesNotMatch(memberRoute, /\.from\("shipping_fee_payments"\)/);

  assert.match(storageRoute, /auth\.user as unknown as RpcClient/);
  assert.match(storageRoute, /"get_my_inventory_overview"/);
  assert.match(storageRoute, /hasExactKeys\(value,\s*\["rolloutEnabled",\s*"items",\s*"serverTime"\]\)/);
  assert.match(storageRoute, /"get_my_won_products"/);
  assert.match(storageRoute, /legacyAuctionWins/);
  assert.match(storageRoute, /itemSelectedShipmentsEnabled/);
  assert.match(storageRoute, /itemSelectedProductIds/);
  assert.match(storageRoute, /\.filter\(\(win\)\s*=>\s*!itemSelectedProductIds\.has\(win\.product_id\)\)/);
  assert.match(shipmentHistoryRoute, /auth\.user as unknown as RpcClient/);
  assert.match(shipmentHistoryRoute, /"get_my_inventory_shipments"/);
  assert.match(shipmentHistoryRoute, /hasExactKeys\(value,\s*\["shipments"\]\)/);

  assert.match(hiddenTestRoute, /test_member_shipping_retired/);
  assert.match(hiddenTestRoute, /410/);
});

test("current operator shipping uses v2 CAS packing and exact unfulfilled-item gate", async () => {
  const [operatorRoute, operator] = await Promise.all([
    source("src/app/api/admin/operator/shipping/route.ts"),
    source("src/components/admin/operator/OperatorShippingConsole.tsx"),
  ]);

  assert.match(operatorRoute, /authenticateStaffRequest\(request,\s*true\)/);
  assert.match(operatorRoute, /auth\.user as unknown as RpcClient/);
  assert.match(operatorRoute, /"get_inventory_shipment_queue"/);
  assert.match(operatorRoute, /"pack_inventory_shipment"/);
  assert.match(operatorRoute, /"ship_inventory_shipment"/);
  assert.match(operatorRoute, /p_expected_version:\s*body\.expectedVersion/);
  assert.match(operatorRoute, /p_idempotency_key:\s*body\.idempotencyKey/);
  assert.match(
    operatorRoute,
    /error\.code\s*===\s*"55000"\s*&&\s*error\.message\s*===\s*"미 출고된 상품이 존재합니다"/,
  );
  assert.match(operatorRoute, /code:\s*"UNRELEASED_ITEMS"/);
  assert.match(operatorRoute, /blockedItemIds/);
  assert.match(operatorRoute, /"addressSnapshot"/);
  assert.match(operatorRoute, /},\s*422\)/);
  assert.doesNotMatch(
    operatorRoute,
    /get_commerce_shipment_queue|pack_commerce_shipment|ship_commerce_shipment|mark_shipping_request_shipped|get_shipping_work/,
  );

  assert.match(operator, /shipmentId:\s*shipment\.id/);
  assert.match(operator, /expectedVersion:\s*shipment\.version/);
  assert.match(operator, /idempotencyKey/);
  assert.match(operator, /item\.lineStatus\s*===\s*"ready"/);
  assert.match(operator, /item\.physicalStatus\s*===\s*"center_stored"/);
  assert.match(operator, /work\.status\s*===\s*"outbound_complete"/);
  assert.match(operator, /"미 출고된 상품이 존재합니다"/);
  assert.match(operator, /shipment\.addressSnapshot\.recipientName/);
  assert.match(operator, /shipment\.addressSnapshot\.postalCode/);
  assert.match(operator, /action\s*===\s*"pack"/);
  assert.match(operator, /action\s*===\s*"ship"/);
});

test("customer UI supports mixed per-business rollout while keeping each request single-mode", async () => {
  const account = await source("src/components/features/account/AccountDashboard.tsx");

  assert.match(account, /selectedInventoryItemIds/);
  assert.match(account, /selectedOrderId/);
  assert.match(account, /fetch\("\/api\/orders"/);
  assert.match(account, /legacyAuctionWins/);
  assert.match(account, /itemSelectedCommerceOrderItemIds/);
  assert.match(account, /items\.some\(\(item\)\s*=>\s*itemSelectedCommerceOrderItemIds\.has\(item\.id\)\)/);
  assert.match(account, /storage\.filter\(\(item\)\s*=>\s*item\.rolloutEnabled\)/);
  assert.match(account, /item\.itemSelectedShipmentsEnabled/);
  assert.match(account, /selectedShippingMode/);
  assert.match(account, /const selectedIds\s*=\s*\[\.\.\.selectedInventoryItemIds\]\.sort\(\)/);
  assert.match(account, /inventoryItemIds:\s*selectedIds/);
  assert.match(account, /orderId:\s*selectedLegacyOrder\?\.id/);
  assert.match(account, /body:\s*JSON\.stringify\(useV2/);
  assert.match(account, /requestEligibleItems\.map\(\(item\)\s*=>\s*item\.id\)/);
  assert.match(account, /disabled=\{disabled\}/);
  assert.match(account, /전환이 완료된 매장의 상품은 필요한 상품만 골라 함께 신청할 수 있습니다/);
  assert.match(account, /전환 전 매장의 결제 완료 상품은 주문 한 건 전체를 선택합니다/);
  assert.match(account, /setSelectedOrderId\(""\)/);
  assert.match(account, /setSelectedInventoryItemIds\(\[\]\)/);
  assert.match(account, /선택 상품 배송 신청/);
  assert.match(account, /shipment\.trackingNumber\s*&&\s*shipment\.courier/);
  assert.match(account, /배송조회/);
  assert.match(account, /기존 주문 전체 배송 신청/);
  assert.match(account, /선택 주문 전체 배송 신청/);
});

test("retired browser repositories no longer expose legacy shipping mutations", async () => {
  const [operations, memberAccount] = await Promise.all([
    source("src/lib/supabase/operations.ts"),
    source("src/lib/supabase/memberAccount.ts"),
  ]);
  const retiredNames = [
    "request_product_shipping",
    "get_shipping_work",
    "get_pending_shipping_work",
    "upsert_shipping_tracking_batch",
    "mark_shipping_request_shipped",
  ];
  for (const name of retiredNames) {
    assert.doesNotMatch(operations, new RegExp(name));
    assert.doesNotMatch(memberAccount, new RegExp(name));
  }
});

test("generated database types retain historical canonical shipment compatibility", async () => {
  const types = await source("src/lib/supabase/database.types.ts");
  for (const contract of [
    "commerce_shipments:",
    "commerce_shipment_orders:",
    "commerce_shipment_items:",
    "commerce_shipment_events:",
    "commerce_shipment_reconciliation_cases:",
    "request_commerce_order_shipment:",
    "pack_commerce_shipment:",
    "ship_commerce_shipment:",
    "correct_commerce_shipment_tracking:",
    "get_commerce_shipment_queue:",
  ]) {
    assert.match(types, new RegExp(contract));
  }
  assert.match(types, /p_shipping_fee_amount: number \| null/);
  assert.match(types, /p_bank_name_snapshot: string \| null/);
  assert.match(types, /p_account_number_snapshot: string \| null/);
});
