import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (file) => readFile(new URL(file, rootUrl), "utf8");

test("owner ledger repairs are owner-only, idempotent, RLS protected, and append-only", async () => {
  const migration = await source("supabase/migrations/20260826200000_owner_global_ledger_repair_console.sql");
  assert.match(migration, /create table public\.owner_ledger_repair_events/i);
  assert.match(migration, /unique \(actor_owner_id, idempotency_key\)/i);
  assert.match(migration, /before update or delete or truncate[\s\S]*reject_inventory_v2_append_only_mutation/i);
  assert.match(migration, /enable row level security[\s\S]*force row level security/i);
  assert.match(migration, /using \(\(select public\.is_owner\(\)\)\)/i);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /v_actor is null or not public\.is_owner\(\)/i);
  assert.match(migration, /revoke all on function public\.owner_repair_global_ledger[\s\S]*public,anon,authenticated,service_role/i);
  assert.match(migration, /grant execute on function public\.owner_repair_global_ledger[\s\S]*to authenticated/i);
});

test("owner force rollback reverses every platform projection without erasing money history", async () => {
  const migration = await source("supabase/migrations/20260826213000_owner_force_ledger_rollback_and_restore.sql");
  assert.match(migration, /create or replace function public\.owner_force_ledger_rollback/i);
  assert.match(migration, /'cancel_auction_payment','cancel_commerce_order','cancel_legacy_payment'/i);
  assert.match(migration, /entry_type,amount,memo,reversal_of[\s\S]*'reversal'/i);
  assert.match(migration, /entry_kind,amount[\s\S]*'payment_reversal'/i);
  assert.match(migration, /inventory_shipment_items set line_status='cancelled'/i);
  assert.match(migration, /customer_inventory_items set ownership_status='cancelled'/i);
  assert.match(migration, /manual_transfer_orders set status='owner_reversed'/i);
  assert.match(migration, /commerce_orders set status='owner_reversed'/i);
  assert.match(migration, /externalActionsRequired/i);
  assert.doesNotMatch(migration, /delete from public\.manual_transfer_payment_ledger/i);
  assert.doesNotMatch(migration, /delete from public\.store_financial_entries/i);
});

test("owner can restore a force rollback from the append-only audit snapshot", async () => {
  const migration = await source("supabase/migrations/20260826213000_owner_force_ledger_rollback_and_restore.sql");
  assert.match(migration, /create or replace function public\.owner_restore_ledger_repair_event/i);
  assert.match(migration, /action='restore_audit_event'/i);
  assert.match(migration, /sourceEventId/i);
  assert.match(migration, /이미 복구된 감사 기록입니다/i);
  assert.match(migration, /철회 이후 같은 원장에 다른 변경/i);
  assert.match(migration, /grant execute on function public\.owner_restore_ledger_repair_event[\s\S]*to authenticated/i);
});

test("owner ledger API authenticates exact owner and requires explicit repair confirmation", async () => {
  const route = await source("src/app/api/admin/owner/ledger-repair/route.ts");
  assert.match(route, /authenticateOwnerAccessRequest\(request\)/);
  assert.match(route, /requiredConfirmation = FORCE_ACTIONS\.has\(action\) \? "강제철회" : "원장복구"/);
  assert.match(route, /readSmallJsonBody\(request, 12_288\)/);
  assert.match(route, /adminRpc\.rpc\("owner_force_ledger_rollback_service"/);
  assert.match(route, /adminRpc\.rpc\("owner_restore_ledger_repair_event_service"/);
  assert.match(route, /p_actor_owner_id: access\.userId/);
  assert.match(route, /owner_repair_global_ledger/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("force rollback entrypoints are trusted-server-only and revalidate grade-zero Owner", async () => {
  const migration = await source("supabase/migrations/20260826214000_restrict_owner_force_ledger_to_trusted_server.sql");
  assert.match(migration, /auth\.role\(\) <> 'service_role'/i);
  assert.match(migration, /role_code = 'owner'[\s\S]*grade_level = 0/i);
  assert.match(migration, /revoke all on function public\.owner_force_ledger_rollback\([\s\S]*authenticated,service_role/i);
  assert.match(migration, /grant execute on function public\.owner_force_ledger_rollback_service[\s\S]*to service_role/i);
  assert.match(migration, /grant execute on function public\.owner_restore_ledger_repair_event_service[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to authenticated/i);
});

test("force rollback detaches final bids before delete and accepts every audit entity kind", async () => {
  const migration = await source("supabase/migrations/20260826215000_fix_owner_force_ledger_dependency_order.sql");
  assert.match(migration, /before delete on public\.auction_bids[\s\S]*detach_owner_force_final_bid_reference/i);
  assert.match(migration, /owner_force_ledger_enabled\(\)/i);
  assert.match(migration, /update public\.products[\s\S]*final_bid_id = null[\s\S]*where id = old\.product_id[\s\S]*final_bid_id = old\.id/i);
  assert.match(migration, /'commerce_order'[\s\S]*'legacy_payment'/i);
  assert.match(migration, /revoke all on function app_private\.detach_owner_force_final_bid_reference/i);
});

test("owner center exposes the unified member ledger repair console", async () => {
  const [layout, page, consoleSource] = await Promise.all([
    source("src/app/(admin)/admin/owner/layout.tsx"),
    source("src/app/(admin)/admin/owner/ledger-repair/page.tsx"),
    source("src/components/admin/owner/OwnerLedgerRepairConsole.tsx"),
  ]);
  assert.match(layout, /\/admin\/owner\/ledger-repair/);
  assert.match(layout, /운영 데이터 복구/);
  assert.match(page, /OwnerLedgerRepairConsole/);
  for (const label of ["상품별 연결 거래", "연결 거래 전체 강제 철회", "최근 복구 감사 기록"]) {
    assert.match(consoleSource, new RegExp(label));
  }
  assert.doesNotMatch(consoleSource, /<h2[^>]*>결제·미결제<\/h2>/);
  assert.doesNotMatch(consoleSource, /<h2[^>]*>보관 상품<\/h2>/);
  assert.doesNotMatch(consoleSource, /<h2[^>]*>배송 신청·발송<\/h2>/);
  assert.match(consoleSource, /FORCE_ACTIONS\.has\(target\.action\) \? "강제철회" : "원장복구"/);
  assert.match(consoleSource, /감사 기록의 변경 전 스냅샷으로 플랫폼 원장을 복구/);
  assert.match(consoleSource, /실제 입금 반환 확인 필요/);
  assert.match(consoleSource, /실물 배송 회수 확인 필요/);
});

test("owner ledger server can read fulfillment tables without granting browser access", async () => {
  const migration = await source("supabase/migrations/20260826203000_restore_service_inventory_ledger_reads.sql");
  assert.match(migration, /grant select on table public\.inventory_shipments to service_role/i);
  assert.match(migration, /grant select on table public\.inventory_shipment_items to service_role/i);
  assert.match(migration, /grant select on table public\.inventory_item_fulfillments to service_role/i);
  assert.doesNotMatch(migration, /to authenticated/i);
});
