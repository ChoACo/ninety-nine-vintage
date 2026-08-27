import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);

test("12-hour payment confirmation requests deduplicate, escalate, and never auto-confirm", async () => {
  const [migration, cutoffMigration, memberRoute, orderHistory, ownerRoute, ownerQueue] = await Promise.all([
    readFile(new URL("supabase/migrations/20260809165948_add_payment_confirmation_escalation.sql", rootUrl), "utf8"),
    readFile(new URL("supabase/migrations/20260810200000_limit_owner_payment_confirmation_queue_to_12_hours.sql", rootUrl), "utf8"),
    readFile(new URL("src/app/api/orders/[id]/payment-confirmation-request/route.ts", rootUrl), "utf8"),
    readFile(new URL("src/components/features/account/OrderHistory.tsx", rootUrl), "utf8"),
    readFile(new URL("src/app/api/admin/owner/payment-confirmation-requests/route.ts", rootUrl), "utf8"),
    readFile(new URL("src/components/admin/owner/OwnerPaymentConfirmationQueue.tsx", rootUrl), "utf8"),
  ]);

  assert.match(migration, /create table public\.commerce_payment_confirmation_requests/i);
  assert.match(migration, /transfer_id uuid not null unique/i);
  assert.match(migration, /commerce_payment_confirmation_request_events/i);
  assert.match(migration, /v_transfer\.requested_at > v_now - interval '12 hours'/i);
  assert.match(migration, /v_request\.last_requested_at > v_now - interval '1 hour'/i);
  assert.match(migration, /metadata ->> 'idempotencyKey' = p_idempotency_key::text/i);
  assert.match(migration, /reminder_count = reminder_count \+ 1/i);
  assert.match(migration, /insert_targeted_notification/i);
  assert.match(migration, /get_owner_payment_confirmation_queue/i);
  assert.doesNotMatch(migration, /confirm_commerce_order_transfer\s*\(/i);
  assert.match(memberRoute, /request_commerce_payment_confirmation/);
  assert.match(orderHistory, /결제 확인 요청하기/);
  assert.match(orderHistory, /다시 알림/);
  assert.match(ownerRoute, /get_owner_payment_confirmation_queue/);
  assert.match(ownerQueue, /12시간 이상 대기 요청/);
  assert.match(cutoffMigration, /12 hours/);
});

test("owner escalation queue is server-filtered at the 12-hour boundary", async () => {
  const migration = await readFile(new URL("supabase/migrations/20260810200000_limit_owner_payment_confirmation_queue_to_12_hours.sql", rootUrl), "utf8");
  assert.match(migration, /requests\.status = 'open'/i);
  assert.match(migration, /requests\.first_requested_at <= clock_timestamp\(\) - interval '12 hours'/i);
  assert.match(migration, /grant execute on function public\.get_owner_payment_confirmation_queue\(\)\s*to authenticated/i);
});

test("auction bank transfers create an immediate, audited owner reconciliation request", async () => {
  const [migration, memberRoute, paymentUi, ownerRoute, ownerQueue] = await Promise.all([
    readFile(new URL("supabase/migrations/20260826184747_improve_manual_transfer_confirmation_and_deadlines.sql", rootUrl), "utf8"),
    readFile(new URL("src/app/api/payments/manual-transfer/route.ts", rootUrl), "utf8"),
    readFile(new URL("src/components/features/account/CombinedAuctionPayment.tsx", rootUrl), "utf8"),
    readFile(new URL("src/app/api/admin/owner/payment-confirmation-requests/route.ts", rootUrl), "utf8"),
    readFile(new URL("src/components/admin/owner/OwnerPaymentConfirmationQueue.tsx", rootUrl), "utf8"),
  ]);

  assert.match(migration, /alter column original_payment_hour set default 23/i);
  assert.match(migration, /set original_payment_hour = 23/i);
  assert.match(migration, /\(p_closed_at at time zone 'Asia\/Seoul'\)::date\s*\+ 3/i);
  assert.match(migration, /create table public\.auction_payment_confirmation_requests/i);
  assert.match(migration, /request_kind in \('buyer', 'system_reconciliation'\)/i);
  assert.match(migration, /request_my_combined_auction_payment_confirmation/i);
  assert.match(migration, /v_review_due_at timestamptz := v_now \+ interval '24 hours'/i);
  assert.match(migration, /A buyer's declaration never confirms money/i);
  assert.doesNotMatch(migration, /request_my_combined_auction_payment_confirmation[\s\S]*confirm_combined_auction_payment\s*\(/i);
  assert.match(migration, /orphan_auction_bundle_after_unpaid_expiry/i);
  assert.match(migration, /get_owner_auction_payment_confirmation_queue/i);
  assert.match(memberRoute, /action === "request_confirmation"/);
  assert.match(memberRoute, /request_my_combined_auction_payment_confirmation/);
  assert.match(paymentUi, /입금했어요 · 확인 요청/);
  assert.match(paymentUi, /24시간 검토 시간/);
  assert.match(ownerRoute, /get_owner_auction_payment_confirmation_queue/);
  assert.match(ownerQueue, /시스템이 복구한 대사 요청/);
});

test("auction payment start is atomically registered and Owner can force completion with settlement disposition", async () => {
  const [migration, memberRoute, ownerRoute, ownerQueue, secondChanceRoute] = await Promise.all([
    readFile(new URL("supabase/migrations/20260826221618_manual_second_chance_and_owner_forced_payment.sql", rootUrl), "utf8"),
    readFile(new URL("src/app/api/payments/manual-transfer/route.ts", rootUrl), "utf8"),
    readFile(new URL("src/app/api/admin/owner/payment-confirmation-requests/route.ts", rootUrl), "utf8"),
    readFile(new URL("src/components/admin/owner/OwnerPaymentConfirmationQueue.tsx", rootUrl), "utf8"),
    readFile(new URL("src/app/api/admin/operator/auctions/[id]/second-chance/route.ts", rootUrl), "utf8"),
  ]);

  assert.match(migration, /begin_my_combined_auction_payment_registered/i);
  assert.match(migration, /request_kind in \('payment_started', 'buyer', 'system_reconciliation'\)/i);
  assert.match(migration, /owner_force_confirm_auction_payment_request/i);
  assert.match(migration, /settlement_disposition in \('included', 'excluded'\)/i);
  assert.match(migration, /inventory\.settlement_disposition='included'/i);
  assert.match(migration, /voidedWarningCount/i);
  assert.match(memberRoute, /begin_my_combined_auction_payment_registered/);
  assert.match(memberRoute, /request_my_combined_auction_payment_confirmation_v2/);
  assert.match(ownerRoute, /action === "force_confirm"/);
  assert.match(ownerRoute, /owner_force_confirm_auction_payment_request/);
  assert.match(ownerQueue, /강제 결제완료/);
  assert.match(ownerQueue, /정산 미포함/);
  assert.match(secondChanceRoute, /operator_process_second_chance_manual/);
});
