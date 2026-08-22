import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260822155921_add_delivery_tracking_and_d1_settlement.sql");
const tracker = read("src/lib/shipping/courierTracker.ts");
const trackingCron = read("src/app/api/cron/track-deliveries/route.ts");
const settlementCron = read("src/app/api/cron/auto-settlement/route.ts");
const vercel = read("vercel.json");

test("delivery tracking uses the authenticated current GraphQL API", () => {
  assert.match(tracker, /https:\/\/apis\.tracker\.delivery\/graphql/);
  assert.match(tracker, /TRACKQL-API-KEY/);
  assert.match(tracker, /lastEvent/);
  assert.match(tracker, /code === "delivered"/);
  assert.match(tracker, /AbortSignal\.timeout\(15_000\)/);
  assert.doesNotMatch(tracker, /\/carriers\/\$\{.*\/tracks\//);
});

test("delivery and D+1 settlement remain atomic and idempotent", () => {
  assert.match(migration, /record_inventory_delivery_tracking/);
  assert.match(migration, /for update/);
  assert.match(migration, /auto_settle_at=p_delivered_at\+interval '24 hours'/);
  assert.match(migration, /confirmation_due_at=p_delivered_at\+interval '24 hours'/);
  assert.match(migration, /settlement_status='settled'/);
  assert.match(migration, /metadata->>'shipmentId'=p_shipment_id::text/);
  assert.match(migration, /settlement_batch_id is null/);
  assert.match(migration, /'infinity'::timestamptz/);
  assert.doesNotMatch(migration, /create table public\.settlement_ledger/);
});

test("daily hobby-compatible cron routes are secret protected and bounded", () => {
  for (const route of [trackingCron, settlementCron]) {
    assert.match(route, /CRON_SECRET/);
    assert.match(route, /if \(!cronSecret/);
  }
  assert.match(trackingCron, /p_limit: 20/);
  assert.match(settlementCron, /p_limit: 100/);
  assert.match(migration, /delivery_status='delivered'/);
  assert.match(migration, /배송 완료 확인 후 구매 확정할 수 있습니다/);
  const config = JSON.parse(vercel);
  assert.deepEqual(config.crons.find((cron) => cron.path === "/api/cron/track-deliveries"), {
    path: "/api/cron/track-deliveries",
    schedule: "0 1 * * *",
  });
  assert.deepEqual(config.crons.find((cron) => cron.path === "/api/cron/auto-settlement"), {
    path: "/api/cron/auto-settlement",
    schedule: "0 2 * * *",
  });
});
