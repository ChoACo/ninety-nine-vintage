import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("shipment address reveal is append-only, private, audited, and short-lived", async () => {
  const sql = await source(
    "supabase/migrations/20260809160848_audited_shipment_address_reveal.sql",
  );
  const rpc = sql.match(/create or replace function public\.reveal_inventory_shipment_address[\s\S]*?\n\$\$;/i)?.[0] ?? "";

  assert.match(sql, /enable row level security/i);
  assert.match(sql, /force row level security/i);
  assert.match(sql, /revoke all on table public\.inventory_shipment_address_access_events/i);
  assert.match(sql, /inventory_shipment_address_access_events_immutable/i);
  assert.match(rpc, /can_access_inventory_shipment[\s\S]*'create_shipments'/i);
  assert.match(rpc, /char_length\(v_reason\) not between 3 and 500/i);
  assert.match(rpc, /status = 'cancelled'[\s\S]*delivery_completed_at is not null/i);
  assert.match(rpc, /on conflict \(actor_user_id, idempotency_key\) do nothing/i);
  assert.match(rpc, /interval '5 minutes'/i);
});

test("address API accepts only a reason and idempotency key and validates its RPC result", async () => {
  const route = await source("src/app/api/admin/operator/shipping/[id]/address/route.ts");

  assert.match(route, /authenticateStaffRequest\(request, true\)/);
  assert.match(route, /!\["reason", "idempotencyKey"\]\.includes\(key\)/);
  assert.match(route, /reveal_inventory_shipment_address/);
  assert.match(route, /data\.shipmentId !== id/);
  assert.match(route, /commerceJson\(\{ reveal: data \}\)/);
});

test("shipping console defaults to masked data and forgets a revealed address after five minutes", async () => {
  const consoleSource = await source(
    "src/components/admin/operator/OperatorShippingConsole.tsx",
  );

  assert.match(consoleSource, /shipment\.addressSnapshot\.recipientName/);
  assert.match(consoleSource, /addressReveal\.address\.recipientName/);
  assert.match(consoleSource, /열람 사유 \(예: 송장 출력\)/);
  assert.match(consoleSource, /idempotencyKey: crypto\.randomUUID\(\)/);
  assert.match(consoleSource, /5 \* 60 \* 1000/);
  assert.match(consoleSource, /delete next\[shipment\.id\]/);
  assert.doesNotMatch(consoleSource, /localStorage.*address|sessionStorage.*address/i);
});
