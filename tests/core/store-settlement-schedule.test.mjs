import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../../supabase/migrations/20260809180554_enforce_store_settlement_schedule_and_rates.sql", import.meta.url);

test("settlement batches use Monday or Thursday 09:00 KST and round payouts up to ten won", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /extract\(isodow from p_settlement_date\) not in \(1,4\)/i);
  assert.match(migration, /09:00:00 Asia\/Seoul/i);
  assert.match(migration, /clock_timestamp\(\)<v_cutoff/i);
  assert.match(migration, /ceil\(candidates\.net\/10\.0\)\*10/i);
  assert.match(migration, /on conflict\(store_id,settlement_date\) do nothing/i);
});

test("sale and shipping commission entries snapshot the store plan rate", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /then 0\.035::numeric else 0\.05::numeric/i);
  assert.match(migration, /planSnapshot/i);
  assert.match(migration, /store_commission_rate\(items\.origin_store_id,new\.shipped_at\)/i);
  assert.match(migration, /store_commission_rate\(allocations\.billing_store_id,new\.shipped_at\)/i);
  assert.match(migration, /allocations\.billing_store_id,'shipping_fee'/i);
});

test("refunds reverse the exact original commission and store dashboards expose ledger totals", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /'originalCommissionEntryId',original\.id/i);
  assert.match(migration, /'item-refund-commission:'\|\|new\.id::text/i);
  assert.match(migration, /'shipping-refund-commission:'\|\|new\.id::text/i);
  assert.match(migration, /'totalSettlementSales'/i);
  assert.match(migration, /'weeklySales'/i);
  assert.match(migration, /'nextSettlementEstimate'/i);
  assert.match(migration, /'paidTotal'/i);
  assert.match(migration, /'settlementEntries'/i);
});

test("subscription fees keep the first billing anchor and are accrued by a protected daily job", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /'firstStartedAt',v_subscription\.started_at/i);
  assert.match(migration, /least\(v_subscription\.billing_anchor_day/i);
  assert.match(migration, /accrue-store-subscription-fees/i);
  assert.match(migration, /'10 15 \* \* \*'/i);
  assert.match(migration, /grant execute on function public\.accrue_store_subscription_fees\(timestamptz\) to service_role/i);
});
