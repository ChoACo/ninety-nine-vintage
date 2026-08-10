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
