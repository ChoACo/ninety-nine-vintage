import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../../supabase/migrations/20260822161639_add_regular_settlement_rollovers.sql", import.meta.url);
const migration = await readFile(migrationPath, "utf8");
const cron = await readFile(new URL("../../src/app/api/cron/generate-settlements/route.ts", import.meta.url), "utf8");
const vercel = JSON.parse(await readFile(new URL("../../vercel.json", import.meta.url), "utf8"));
const desk = await readFile(new URL("../../src/components/admin/owner/OwnerPayoutDesk.tsx", import.meta.url), "utf8");

test("regular settlement runs Monday and Thursday at 18:00 KST through an authenticated cron", () => {
  assert.match(migration, /18:00:00 Asia\/Seoul/);
  assert.match(migration, /extract\(isodow from p_settlement_date\) not in \(1,4\)/);
  assert.match(cron, /CRON_SECRET/);
  assert.deepEqual(vercel.crons.find((entry) => entry.path === "/api/cron/generate-settlements"), { path: "/api/cron/generate-settlements", schedule: "0 9 * * 1,4" });
});

test("fee applications preserve the immutable fee ledger and prevent duplicate deductions", () => {
  assert.match(migration, /create table if not exists public\.store_fee_applications/);
  assert.match(migration, /greatest\(0, -fees\.amount-coalesce\(applied\.total,0\)\)/);
  assert.match(migration, /v_deduct := least\(greatest\(v_net_before_fee,0\),v_fee_due\)/);
  assert.match(migration, /v_rollovers := case when v_remaining=0 then 0 else v_store\.fee_rollover_count\+1 end/);
  assert.match(migration, /v_rollovers>=4/);
});

test("owner payout desk keeps bank details masked until an audited reveal", () => {
  assert.match(migration, /accountNumberMasked/);
  assert.doesNotMatch(migration, /add column if not exists bank_account/);
  assert.match(desk, /계좌 원문 열람/);
  assert.match(desk, /감사 기록 사유/);
  assert.match(desk, /입금 후 정산 완료/);
});
