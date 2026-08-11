import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("member storage is cross-store while winners and fulfillment stay assigned-store scoped", async () => {
  const [migration, fulfillmentMigration, route, layout, consoleSource] = await Promise.all([
    source("supabase/migrations/20260724091825_member_bid_shipping_operations.sql"),
    source("supabase/migrations/20260724063531_simplify_direct_store_fulfillment.sql"),
    source("src/app/api/admin/operator/member-operations/route.ts"),
    source("src/app/(admin)/admin/operator/layout.tsx"),
    source("src/components/admin/operator/OperatorMemberOperationsConsole.tsx"),
  ]);

  const storageFunction = migration.match(
    /create or replace function public\.get_operator_member_storage[\s\S]*?(?=create or replace function public\.get_inventory_shipment_queue)/,
  )?.[0] ?? "";
  const winnerMigration = await source(
    "supabase/migrations/20260724082849_align_closed_sale_inventory_and_tracking.sql",
  );
  const winnerFunction = winnerMigration.match(
    /create or replace function public\.get_operator_winning_members[\s\S]*?(?=create or replace function public\.get_my_inventory_overview)/,
  )?.[0] ?? "";
  assert.match(
    storageFunction,
    /public\.can_view_shared_fulfillment\(\)/,
  );
  assert.doesNotMatch(storageFunction, /has_store_permission/);
  assert.match(storageFunction, /not exists[\s\S]*inventory_shipment_items/);
  assert.match(storageFunction, /'shipmentRequested', false/);
  assert.match(
    winnerFunction,
    /public\.is_owner\(\)\s+or public\.has_store_permission\(p\.store_id, 'prepare_orders'\)/,
  );
  assert.match(winnerFunction, /confirmed_order\.status = 'confirmed'/);
  assert.match(
    fulfillmentMigration,
    /public\.is_owner\(\) or public\.has_store_permission\(i\.origin_store_id, 'prepare_orders'\)/,
  );
  assert.match(migration, /create or replace function public\.get_operator_member_storage/);
  assert.match(winnerMigration, /create or replace function public\.get_operator_winning_members/);
  assert.match(migration, /revoke all on function public\.get_operator_member_storage[\s\S]*from public, anon, service_role/);
  assert.match(route, /auth\.roleCode !== "owner" && auth\.roleCode !== "operator"/);
  assert.match(layout, /회원 보관함/);
  assert.match(layout, /낙찰된 회원/);
  assert.match(consoleSource, /매장 출고 전/);
  assert.match(consoleSource, /보관 완료/);
  assert.match(consoleSource, /회원명, 회원 ID, 상품명, 매장명 검색/);
  assert.match(consoleSource, /selectedStorageByStore/);
  assert.match(consoleSource, /<PremiumDialog/);
});

test("operator payments expose seven-day history, amount adjustment, and reversible receipts", async () => {
  const [queueRoute, confirmRoute, consoleSource] = await Promise.all([
    source("src/app/api/admin/operator/payments/route.ts"),
    source("src/app/api/admin/operator/payments/[kind]/[id]/confirm/route.ts"),
    source("src/components/admin/operator/OperatorPaymentsConsole.tsx"),
  ]);

  assert.match(queueRoute, /7 \* 24 \* 60 \* 60 \* 1_000/);
  assert.match(queueRoute, /payment\.status === "cancelled" \|\| payment\.status === "cancelled_unpaid"/);
  assert.match(queueRoute, /reversibleLedgerId/);
  assert.match(confirmRoute, /fields\.every\(\(field\) => Object\.hasOwn\(value, field\)\)/);
  assert.doesNotMatch(confirmRoute, /Object\.keys\(value\)\.length !== fields\.length/);
  assert.match(consoleSource, /금액 변경하기/);
  assert.match(consoleSource, /입금 확인 취소하기/);
  assert.match(consoleSource, /입금 확인 완료 · 최근 7일/);
  assert.match(consoleSource, /<PremiumDialog/);
  assert.match(consoleSource, /입금 확인 상세보기/);
  assert.match(consoleSource, /내용 확인 후 입금 확인 완료/);
  assert.match(consoleSource, /manualTransferReceiptFingerprint/);
  assert.match(consoleSource, /manualTransferReversalFingerprint/);
  assert.match(consoleSource, /getOrCreatePendingManualTransferReceipt/);
  assert.doesNotMatch(consoleSource, /idempotencyStorageKey/);
});

test("owner payment page mounts the full confirmation console without operator store scope", async () => {
  const [page, server, queueRoute, confirmRoute, ledgerRoute] = await Promise.all([
    source("src/app/(admin)/admin/owner/payments/page.tsx"),
    source("src/lib/commerce/server.ts"),
    source("src/app/api/admin/operator/payments/route.ts"),
    source("src/app/api/admin/operator/payments/[kind]/[id]/confirm/route.ts"),
    source("src/app/api/admin/operator/transfers/[id]/ledger/route.ts"),
  ]);
  assert.match(page, /OperatorPaymentsConsole/);
  assert.match(page, /ownerSurface/);
  assert.match(server, /function authenticateOwnerPaymentRequest/);
  assert.match(queueRoute, /authenticateOwnerPaymentRequest\(request\)/);
  assert.match(confirmRoute, /authenticateOwnerPaymentRequest\(request, true\)/);
  assert.match(ledgerRoute, /authenticateOwnerPaymentRequest\(request, true\)/);
});

test("owner can cancel only an unpaid fixed-price payment request with an audited CAS contract", async () => {
  const [migration, route, consoleSource, receiptSource] = await Promise.all([
    source("supabase/migrations/20260811120000_owner_cancel_pending_commerce_payment.sql"),
    source("src/app/api/admin/operator/payments/[kind]/[id]/cancel/route.ts"),
    source("src/components/admin/operator/OperatorPaymentsConsole.tsx"),
    source("src/lib/manualTransferReceipt.ts"),
  ]);

  assert.match(migration, /create table public\.manual_transfer_cancellation_events/);
  assert.match(migration, /if v_actor is null or not public\.is_owner\(\)/);
  assert.match(migration, /v_transfer\.status <> 'awaiting_transfer'/);
  assert.match(migration, /v_order\.status <> 'awaiting_payment'/);
  assert.match(migration, /v_received <> 0 or v_entry_count <> 0/);
  assert.match(migration, /status = 'cancelled'/);
  assert.match(migration, /payment_status = 'cancelled'/);
  assert.match(migration, /set status = 'active'/);
  assert.match(migration, /insert_targeted_notification/);
  assert.match(route, /authenticateOwnerPaymentRequest\(request, true\)/);
  assert.match(route, /kind !== "commerce"/);
  assert.match(route, /cancel_owner_pending_manual_payment/);
  assert.match(route, /observedReceivedAmount !== 0/);
  assert.match(consoleSource, /canCancelPendingPayment/);
  assert.match(consoleSource, /입금 요청 취소/);
  assert.match(consoleSource, /manualTransferCancellationFingerprint/);
  assert.match(receiptSource, /interface CancellationFingerprintInput/);
});

test("member shipment history only exposes preparing or shipped and uses Hanjin lookup", async () => {
  const [migration, route, dashboard] = await Promise.all([
    source("supabase/migrations/20260724073345_operator_payment_and_member_operations.sql"),
    source("src/app/api/account/shipments/route.ts"),
    source("src/components/features/account/AccountDashboard.tsx"),
  ]);

  assert.match(migration, /'publicStatus', case when sh\.tracking_number is null then 'preparing' else 'shipped' end/);
  assert.match(migration, /https:\/\/www\.hanjin\.com\/kor\/CMS\/DeliveryMgr\/WaybillResult\.do/);
  assert.match(route, /value\.publicStatus === "preparing" \|\| value\.publicStatus === "shipped"/);
  assert.match(dashboard, /발송 준비중/);
  assert.match(dashboard, /상품 발송/);
  assert.match(dashboard, /shipment\.publicStatus === "shipped" \? "발송 완료" : "배송 신청"/);
  assert.match(dashboard, /<details className="mt-4 border border-line">/);
  assert.match(dashboard, /송장번호 복사/);
  assert.match(dashboard, /택배사 조회/);
  assert.match(dashboard, /<PremiumDialog/);
});
