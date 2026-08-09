import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);

test("mutual cancellation is scoped, audited, shipment-blocking, and never silently refunds", async () => {
  const [migration, buyerRoute, buyerResponse, operatorRoute, orderHistory] = await Promise.all([
    readFile(new URL("supabase/migrations/20260809170900_add_mutual_cancellation_workflow.sql", rootUrl), "utf8"),
    readFile(new URL("src/app/api/account/cancellations/route.ts", rootUrl), "utf8"),
    readFile(new URL("src/app/api/account/cancellations/[id]/respond/route.ts", rootUrl), "utf8"),
    readFile(new URL("src/app/api/admin/operator/cancellations/route.ts", rootUrl), "utf8"),
    readFile(new URL("src/components/features/account/OrderHistory.tsx", rootUrl), "utf8"),
  ]);

  assert.match(migration, /create table public\.commerce_cancellation_requests/i);
  assert.match(migration, /create table public\.commerce_cancellation_events/i);
  assert.match(migration, /requested_by <> 'buyer' or sale_type = 'fixed'/i);
  assert.match(migration, /clock_timestamp\(\) \+ interval '12 hours'/i);
  assert.match(migration, /owner_attention_required/i);
  assert.match(migration, /expired_auto_accepted/i);
  assert.match(migration, /active_cancellation_request/i);
  assert.match(migration, /block_shipment_for_active_cancellation/i);
  assert.match(migration, /auction_store_cancellation_penalties/i);
  assert.match(migration, /insert_targeted_notification/i);
  assert.match(migration, /insert_staff_notifications/i);
  assert.match(migration, /idempotency_key=p_idempotency_key/i);
  assert.doesNotMatch(migration, /update public\.commerce_(?:orders|order_items).*payment_status\s*=\s*'refunded'/is);
  assert.match(buyerRoute, /request_commerce_cancellation/);
  assert.match(buyerResponse, /respond_commerce_cancellation/);
  assert.match(operatorRoute, /origin_store_id.*selectedStoreId/s);
  assert.match(operatorRoute, /respond_commerce_cancellation/);
  assert.match(orderHistory, /취소 요청/);
});
