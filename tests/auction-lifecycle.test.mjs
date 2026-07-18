import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const rootUrl = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("enforces the KST 21:00-22:00 blackout on client and database clocks", async () => {
  const [migration, policySource] = await Promise.all([
    source("supabase/migrations/20260718061000_add_auction_lifecycle_controls.sql"),
    source("src/utils/auctionBidPolicy.ts"),
  ]);
  const compiled = ts.transpileModule(policySource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const policy = await import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );

  assert.match(migration, /at time zone 'Asia\/Seoul'/);
  assert.match(migration, />= time '21:00:00'/);
  assert.match(migration, /< time '22:00:00'/);
  assert.match(
    migration,
    /create or replace function public\.place_bid[\s\S]*public\.is_auction_blackout\(v_now\)/,
  );
  assert.equal(policy.getDailyAuctionPhase("2026-07-17T11:59:59.000Z"), "existing-participants-only");
  assert.equal(policy.getDailyAuctionPhase("2026-07-17T12:00:00.000Z"), "closed");
  assert.equal(policy.getDailyAuctionPhase("2026-07-17T12:59:59.000Z"), "closed");
  assert.equal(policy.getDailyAuctionPhase("2026-07-17T13:00:00.000Z"), "open");
});

test("closes bid auctions, rolls unsold auctions, and preserves the close cron identity", async () => {
  const migration = await source(
    "supabase/migrations/20260718061000_add_auction_lifecycle_controls.sql",
  );

  assert.match(migration, /create or replace function public\.finalize_due_auctions/);
  assert.match(migration, /order by bids\.amount desc, bids\.created_at, bids\.id/);
  assert.match(migration, /if v_winner\.id is null then[\s\S]*set closes_at = v_next_close/);
  assert.match(migration, /else[\s\S]*status = 'closed'/);
  assert.match(migration, /final_bid_id = v_winner\.id/);
  assert.match(migration, /'close-expired-products'/);
  assert.match(migration, /select public\.finalize_due_auctions\(clock_timestamp\(\)\)/);
});

test("keeps owner test controls private and append-only audited", async () => {
  const migration = await source(
    "supabase/migrations/20260718061000_add_auction_lifecycle_controls.sql",
  );

  for (const rpc of [
    "owner_close_auction_now",
    "owner_override_auction_price",
    "owner_place_test_bid",
  ]) {
    assert.match(
      migration,
      new RegExp(`create or replace function public\\.${rpc}[\\s\\S]*?public\\.is_owner\\(\\)`),
    );
  }
  assert.match(migration, /public\.is_owner_hidden_test_member\(p_test_member_id\)/);
  assert.match(migration, /hidden_test\.owner_id = v_actor/);
  assert.match(migration, /create table if not exists public\.owner_auction_action_audit/);
  assert.match(migration, /subject_member_id uuid/);
  assert.match(migration, /before update or delete on public\.owner_auction_action_audit/);
  assert.equal((migration.match(/insert into public\.owner_auction_action_audit/g) ?? []).length, 3);
});

test("publishes only sold snapshots and masked winner nicknames", async () => {
  const [migration, repository] = await Promise.all([
    source("supabase/migrations/20260718061000_add_auction_lifecycle_controls.sql"),
    source("src/lib/supabase/auctionLifecycle.ts"),
  ]);

  const soldFunction = migration.slice(
    migration.indexOf("create or replace function public.get_public_sold_auctions"),
  );
  assert.match(soldFunction, /products\.status = 'closed'/);
  assert.match(soldFunction, /products\.final_bid_id is not null/);
  assert.match(soldFunction, /public\.mask_public_auction_name/);
  assert.match(soldFunction, /is_owner_hidden_test_member\(winner\.bidder_id\) then '\*\*\*'/);
  assert.doesNotMatch(soldFunction, /winner_id uuid/);
  assert.match(soldFunction, /to anon, authenticated/);
  assert.match(repository, /fetchPublicSoldAuctions/);
  assert.match(repository, /ownerCloseAuctionNow/);
  assert.match(repository, /ownerOverrideAuctionPrice/);
  assert.match(repository, /ownerPlaceTestBid/);
});

test("keeps hidden-test payment preparation service-only without weakening winner checks", async () => {
  const migration = await source(
    "supabase/migrations/20260718064000_harden_owner_test_payment_and_auction_mutations.sql",
  );
  const paymentFunction = migration.slice(
    migration.indexOf("create or replace function public.prepare_portone_payment"),
    migration.indexOf("create or replace function public.update_managed_product"),
  );

  assert.match(paymentFunction, /v_is_active_owner_test_member boolean/);
  assert.match(
    paymentFunction,
    /owner_hidden_test_members[\s\S]*test_members\.retired_at is null/,
  );
  assert.match(
    paymentFunction,
    /not v_is_active_owner_test_member[\s\S]*not public\.auth_user_has_kakao_identity/,
  );
  assert.match(
    paymentFunction,
    /not v_is_active_owner_test_member[\s\S]*v_requires_verified_profile/,
  );
  assert.match(paymentFunction, /accounts\.account_status = 'active'/);
  assert.match(paymentFunction, /v_winner_id <> p_member_id/);
  assert.match(paymentFunction, /v_order\.expected_amount <> v_winning_amount/);
  assert.match(
    paymentFunction,
    /revoke all on function public\.prepare_portone_payment[\s\S]*from public, anon, authenticated, service_role/,
  );
  assert.match(
    paymentFunction,
    /grant execute on function public\.prepare_portone_payment[\s\S]*to service_role/,
  );
  assert.doesNotMatch(
    paymentFunction,
    /grant execute on function public\.prepare_portone_payment[\s\S]*to authenticated/,
  );
});

test("prevents ordinary product editing from manufacturing closed auctions or changing live prices", async () => {
  const migration = await source(
    "supabase/migrations/20260718064000_harden_owner_test_payment_and_auction_mutations.sql",
  );
  const productFunction = migration.slice(
    migration.indexOf("create or replace function public.update_managed_product"),
    migration.indexOf("alter table public.owner_auction_action_audit force row level security"),
  );

  assert.match(productFunction, /p_status not in \('pending', 'active'\)/);
  assert.match(productFunction, /if v_product\.status = 'closed' then/);
  assert.match(
    productFunction,
    /v_product\.status = 'active' and p_status <> 'active'/,
  );
  assert.match(
    productFunction,
    /v_product\.status = 'active'[\s\S]*p_publish_at <> v_product\.publish_at/,
  );
  assert.match(
    productFunction,
    /v_product\.status = 'active'[\s\S]*p_starting_price <> v_product\.starting_price/,
  );
  assert.match(
    productFunction,
    /v_product\.status = 'active'[\s\S]*p_bid_increment <> v_product\.bid_increment/,
  );
  assert.match(productFunction, /v_has_bids[\s\S]*p_publish_at <> v_product\.publish_at/);
  assert.match(
    productFunction,
    /v_closes_at := case[\s\S]*when v_product\.status = 'active' then v_product\.closes_at/,
  );
  assert.match(productFunction, /else \([\s\S]*at time zone 'Asia\/Seoul'/);
  assert.match(
    productFunction,
    /current_price = case[\s\S]*when v_product\.status = 'active' or v_has_bids[\s\S]*then v_product\.current_price/,
  );
  assert.match(
    productFunction,
    /revoke all on function public\.update_managed_product[\s\S]*from public, anon, authenticated, service_role/,
  );
});

test("hardens owner auction audit and keeps hidden-member policy checks off public RPC", async () => {
  const migration = await source(
    "supabase/migrations/20260718064000_harden_owner_test_payment_and_auction_mutations.sql",
  );

  assert.match(migration, /create schema if not exists app_private/);
  assert.match(
    migration,
    /create or replace function app_private\.is_owner_hidden_test_member_for_policy/,
  );
  assert.match(
    migration,
    /grant execute on function app_private\.is_owner_hidden_test_member_for_policy\(uuid\)[\s\S]*to authenticated/,
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.is_owner_hidden_test_member\(uuid\)/,
  );
  assert.equal(
    (migration.match(/not app_private\.is_owner_hidden_test_member_for_policy/g) ?? [])
      .length,
    8,
  );
  assert.match(
    migration,
    /alter table public\.owner_auction_action_audit force row level security/,
  );
  assert.match(
    migration,
    /revoke all on public\.owner_auction_action_audit[\s\S]*service_role/,
  );
  assert.match(
    migration,
    /before update or delete or truncate on public\.owner_auction_action_audit[\s\S]*for each statement/,
  );
});
