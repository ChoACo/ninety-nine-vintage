import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260822155921_add_delivery_tracking_and_d1_settlement.sql");
const policyMigration = read("supabase/migrations/20260826231224_harden_live_auction_policy_v2.sql");
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
  assert.match(policyMigration, /auto_settle_at = delivered_at \+ interval '12 hours'/i);
  assert.match(policyMigration, /confirmation_due_at = shipments\.delivered_at \+ interval '12 hours'/i);
  assert.match(policyMigration, /replace\(v_source, 'interval ''24 hours''', 'interval ''12 hours'''\)/i);
});

test("delivery and settlement cron routes are secret protected, bounded, and scheduled in KST service hours", () => {
  for (const route of [trackingCron, settlementCron]) {
    assert.match(route, /CRON_SECRET/);
    assert.match(route, /envAuthorized/);
    assert.match(route, /verify_web_push_dispatch_secret/);
  }
  assert.match(trackingCron, /p_limit: 20/);
  assert.match(settlementCron, /p_limit: 100/);
  assert.match(migration, /delivery_status='delivered'/);
  assert.match(migration, /배송 완료 확인 후 구매 확정할 수 있습니다/);
  const config = JSON.parse(vercel);
  assert.equal(config.crons.some((cron) => cron.path === "/api/cron/track-deliveries"), false);
  assert.equal(config.crons.some((cron) => cron.path === "/api/cron/auto-settlement"), false);
  assert.match(policyMigration, /track-inventory-deliveries-every-three-hours/);
  assert.match(policyMigration, /0 1,4,7,10,13,22 \* \* \*/);
  assert.match(policyMigration, /settle-delivered-inventory-hourly/);
  assert.match(policyMigration, /0 0-13,22,23 \* \* \*/);
  assert.match(policyMigration, /delivery_tracking_cron_url/);
  assert.match(policyMigration, /auto_settlement_cron_url/);
});
