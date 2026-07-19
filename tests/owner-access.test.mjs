import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("removes PIN state and keeps the one Kakao owner at internal grade zero", async () => {
  const migration = await source(
    "supabase/migrations/20260718060000_hidden_owner_delegation_and_test_member.sql",
  );
  assert.match(migration, /drop function if exists public\.process_owner_mode_pin_attempt/);
  assert.match(migration, /drop table if exists public\.owner_mode_unlock_limits cascade/);
  assert.match(migration, /drop table if exists public\.owner_mode_sessions cascade/);
  assert.match(
    migration,
    /30be08c2-6259-42c6-af26-4ded6362de12[\s\S]*roles\.role_code = 'owner'[\s\S]*roles\.grade_level = 0\.0/,
  );
  const postRemoval = migration.slice(migration.indexOf("do $$"));
  assert.doesNotMatch(postRemoval, /OWNER_MODE_PIN|invalid_pin|verify_owner_mode_pin/i);
});

test("delegates only to the two approved operators with immutable attribution", async () => {
  const migration = await source(
    "supabase/migrations/20260718060000_hidden_owner_delegation_and_test_member.sql",
  );
  assert.match(migration, /9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d/);
  assert.match(migration, /4132c4b2-87e0-4ffe-9ce3-74ca1ae67cee/);
  assert.match(migration, /create table public\.owner_operator_delegation_sessions/);
  assert.match(migration, /create table public\.owner_operator_delegation_audit/);
  assert.match(
    migration,
    /before update or delete or truncate on public\.owner_operator_delegation_audit/,
  );
  assert.match(migration, /create or replace function public\.current_owner_delegated_operator/);
  assert.match(migration, /create trigger products_apply_owner_delegation/);
  assert.match(migration, /new\.created_by := v_effective_actor/);
  assert.match(migration, /new\.updated_by := v_effective_actor/);
  assert.match(migration, /'product\.insert'/);
  assert.match(migration, /'product\.update'/);
  assert.match(
    migration,
    /created_by = \(select public\.current_owner_delegated_operator\(\)\)/,
  );
});

test("keeps the synthetic member hidden while exposing owner-only realistic flows", async () => {
  const migration = await source(
    "supabase/migrations/20260718060000_hidden_owner_delegation_and_test_member.sql",
  );
  const hiddenPredicate = migration.slice(
    migration.indexOf("create or replace function public.is_owner_hidden_test_member"),
    migration.indexOf("create table public.owner_hidden_test_member_audit"),
  );
  assert.doesNotMatch(hiddenPredicate, /retired_at is null/);
  assert.match(migration, /create table public\.owner_hidden_test_members/);
  assert.match(migration, /create trigger owner_hidden_test_member_audit_append_only/);
  assert.match(migration, /create or replace function public\.protect_owner_hidden_test_write/);
  assert.match(migration, /app\.owner_hidden_test_actor/);
  assert.match(migration, /not public\.is_owner_hidden_test_member\(profiles\.id\)/);
  assert.match(migration, /not public\.is_owner_hidden_test_member\(last_seen\.user_id\)/);
  assert.match(migration, /not public\.is_owner_hidden_test_member\(orders\.buyer_id\)/);
  assert.match(migration, /not public\.is_owner_hidden_test_member\(requests\.member_id\)/);
  assert.match(
    migration,
    /create policy "Staff read every bid"[\s\S]*?not public\.is_owner_hidden_test_member\(bidder_id\)/,
  );
  for (const helper of [
    "can_access_support_conversation",
    "can_send_support_message",
    "can_manage_support_conversation",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `create or replace function public\\.${helper}\\([\\s\\S]*?not public\\.is_owner_hidden_test_member\\(conversations\\.member_id\\)`,
      ),
    );
  }

  for (const rpc of [
    "get_owner_hidden_test_member",
    "owner_update_hidden_test_member_profile",
    "owner_upsert_hidden_test_shipping_address",
    "owner_delete_hidden_test_shipping_address",
    "owner_set_hidden_test_shipping_credits",
    "get_owner_hidden_test_won_products",
    "owner_request_hidden_test_shipping",
    "get_owner_hidden_test_shipping_requests",
    "owner_mark_hidden_test_shipping_shipped",
  ]) {
    assert.match(
      migration,
      new RegExp(`create or replace function public\\.${rpc}[\\s\\S]*?access_role_for_user\\(v_owner\\) <> 'owner'`),
    );
  }
  assert.match(migration, /orders\.payment_status = '결제완료'/);
  assert.match(migration, /orders\.portone_status = 'PAID'/);
  assert.match(migration, /'test_member\.shipping_requested'/);
  assert.match(migration, /'test_member\.shipping_marked_shipped'/);
});

test("provisions the non-login test identity only through the Supabase Admin API", async () => {
  const script = await source("scripts/provision-hidden-test-member.mjs");
  assert.match(script, /admin\.auth\.admin\.createUser/);
  assert.match(script, /randomBytes\(48\)/);
  assert.match(script, /randomUUID\(\)/);
  assert.match(script, /ban_duration: "876000h"/);
  assert.match(script, /account_type: "owner_hidden_test"/);
  assert.match(script, /provision_owner_hidden_test_member/);
  assert.match(script, /admin\.auth\.admin\.deleteUser/);
  assert.doesNotMatch(script, /password\s*=\s*["'][^"']+["']/);
});

test("uses a fresh verified owner bearer for every owner API request", async () => {
  const [server, delegation, testMember, address, shipping] = await Promise.all([
    source("src/lib/ownerAccess/server.ts"),
    source("src/app/api/owner/delegation/route.ts"),
    source("src/app/api/owner/test-member/route.ts"),
    source("src/app/api/owner/test-member/addresses/route.ts"),
    source("src/app/api/owner/test-member/shipping/route.ts"),
  ]);
  assert.match(server, /verifier\.auth\.getUser\(accessToken\)/);
  assert.match(server, /data\.user\.id !== OWNER_USER_ID/);
  assert.match(server, /userHasKakaoIdentity\(data\.user\)/);
  assert.match(server, /role\?\.role_code !== "owner"/);
  assert.match(server, /Number\(role\?\.grade_level\) !== 0/);
  assert.match(server, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.doesNotMatch(server, /OWNER_MODE_PIN|cookie|impersonat/i);
  assert.match(delegation, /begin_owner_operator_delegation/);
  assert.match(delegation, /end_owner_operator_delegation/);
  assert.match(testMember, /get_owner_hidden_test_won_products/);
  assert.match(address, /owner_upsert_hidden_test_shipping_address/);
  assert.match(shipping, /owner_request_hidden_test_shipping/);
});

test("uses isolated realtime topics for concurrent product consumers", async () => {
  const [productsHook, soldHook, realtime] = await Promise.all([
    source("src/hooks/useSupabaseProducts.ts"),
    source("src/hooks/usePublicSoldAuctions.ts"),
    source("src/lib/supabase/realtime.ts"),
  ]);

  assert.match(
    productsHook,
    /channel\(createRealtimeChannelName\(`products-\$\{saleType\}-feed`\)\)/,
  );
  assert.match(productsHook, /saleType\?: "auction" \| "fixed"/);
  assert.match(
    soldHook,
    /channel\(createRealtimeChannelName\("public-sold-auctions"\)\)/,
  );
  assert.doesNotMatch(productsHook, /\.channel\("products-feed"\)/);
  assert.doesNotMatch(soldHook, /\.channel\("public-sold-auctions"\)/);
  assert.match(realtime, /globalThis\.crypto\?\.randomUUID/);
});
