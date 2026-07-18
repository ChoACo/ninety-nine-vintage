import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = "supabase/migrations/20260718102000_live_auction_revenue_defense.sql";
const hotfixMigrationPath = "supabase/migrations/20260718103000_live_auction_revenue_defense_hotfix.sql";

const source = (relativePath) =>
  readFile(path.join(root, relativePath), "utf8");

function functionBody(sql, name) {
  const pattern = new RegExp(
    `create(?: or replace)? function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
    "i",
  );
  const match = sql.match(pattern);
  assert.ok(match, `missing SQL function ${name}`);
  return match[0];
}

test("extends a locked auction by exactly three minutes without reopening the normal blackout", async () => {
  const [migration, policy, products, card, clock, app] = await Promise.all([
    source(migrationPath),
    source("src/utils/auctionBidPolicy.ts"),
    source("src/lib/supabase/products.ts"),
    source("src/components/feed/PostCard.tsx"),
    source("src/components/common/AuctionClock.tsx"),
    source("src/components/AuctionApp.tsx"),
  ]);
  const bid = functionBody(migration, "place_bid");
  const ownerBid = functionBody(migration, "owner_place_test_bid");

  assert.match(migration, /anti_sniping_base_closes_at\s+timestamptz/i);
  assert.match(migration, /anti_sniping_extended_at\s+timestamptz/i);
  assert.match(migration, /anti_sniping_extension_count\s+integer not null default 0/i);
  assert.match(migration, /create policy "Staff insert products"[\s\S]*anti_sniping_extension_count = 0/i);
  assert.match(migration, /guard_anti_sniping_metadata/i);
  assert.match(migration, /clear_anti_sniping_after_last_bid/i);
  assert.match(migration, /create or replace function public\.get_auction_server_time/i);
  assert.match(migration, /grant execute on function public\.get_auction_server_time\(\) to anon, authenticated/i);
  assert.ok(bid.indexOf("for update") < bid.indexOf("v_should_extend :="));
  assert.match(bid, /v_product\.closes_at - v_now < interval '3 minutes'/i);
  assert.match(bid, /not v_is_final[\s\S]*v_should_extend/i);
  assert.match(bid, /v_now \+ interval '3 minutes'/i);
  assert.match(bid, /v_is_overtime and v_user_has_bid/i);
  assert.match(bid, /set_config\('app\.authoritative_bid_product_id'/i);
  assert.match(ownerBid, /v_product\.closes_at - v_now < interval '3 minutes'/i);
  assert.match(ownerBid, /'anti_sniping_extended', v_should_extend/i);

  assert.match(policy, /export function isAntiSnipingOvertime/);
  assert.match(policy, /reason: "anti-sniping-overtime"/);
  assert.match(policy, /reason: "anti-sniping-participants-only"/);
  assert.match(products, /"anti_sniping_extension_count"/);
  assert.match(card, /마감 연장 · \+3 MIN/);
  assert.match(clock, /antiSnipingDeadlines/);
  assert.match(app, /antiSnipingDeadlines=\{posts/);
});

test("persists idempotent non-payment penalties and an optional twelve-hour second chance", async () => {
  const [migration, hotfix, repository, gate, account] = await Promise.all([
    source(migrationPath),
    source(hotfixMigrationPath),
    source("src/lib/supabase/secondChanceOffers.ts"),
    source("src/components/payment/SecondChanceOfferGate.tsx"),
    source("src/components/profile/AccountPage.tsx"),
  ]);
  const processor = functionBody(migration, "process_auction_purchase_offers");
  const claim = functionBody(migration, "claim_my_second_chance_offer");
  const warning = migration.match(
    /create or replace function app_private\.apply_system_late_payment_warning[\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(warning);

  assert.match(migration, /create table public\.auction_purchase_offers/i);
  assert.match(migration, /create table public\.auction_offer_penalties/i);
  assert.match(migration, /policy_effective_at\s+timestamptz/i);
  assert.match(migration, /drop constraint if exists manual_transfer_orders_product_id_key/i);
  assert.match(migration, /status in \('awaiting_manual_transfer', 'confirmed', 'cancelled_unpaid'\)/i);
  assert.match(migration, /manual_transfer_orders_live_product_idx/i);
  assert.match(migration, /guard_payment_mode_with_live_offers/i);
  assert.match(migration, /입금 처리 중인 낙찰 상품이 있어 회원 탈퇴를 진행할 수 없습니다/i);
  assert.match(processor, /for update of products/i);
  assert.match(processor, /status = 'cancelled_unpaid'/i);
  assert.match(processor, /'unpaid_winner_expired'/i);
  assert.match(processor, /make_interval\(hours => v_second_chance_hours\)/i);
  assert.match(processor, /v_offer\.offer_kind = 'original'/i);
  assert.match(processor, /public\.is_owner_hidden_test_member/i);
  assert.match(processor, /accounts\.account_status = 'active'/i);
  assert.match(processor, /access_role_for_user\(bids\.bidder_id\)[\s\S]*in \('member', 'band_member'\)/i);
  assert.match(processor, /member_bid_sanctions/i);
  assert.match(processor, /'unpaid_cancelled'/i);
  assert.match(processor, /when public\.is_payment_deadline_exempt\(v_next_bid\.bidder_id\)[\s\S]*then null/i);
  assert.match(warning, /public\.is_payment_deadline_exempt/i);
  assert.match(warning, /access_role_for_user\(p_member_id\)/i);
  assert.match(warning, /on conflict|auction_offer_penalties/i);
  assert.match(warning, /mod\(v_warning_count, 3\) = 0/i);
  assert.match(warning, /public\.cancel_member_active_bids/i);
  assert.match(migration, /'process-auction-purchase-offers',[\s\S]*'\* \* \* \* \*'/i);
  assert.match(claim, /v_product\.final_bid_id is not null/i);
  assert.match(claim, /final_bid_id = v_bid\.id/i);
  assert.match(claim, /v_settings\.active_mode <> 'manual_transfer'/i);
  assert.doesNotMatch(claim, /set status = 'expired_offer'[\s\S]*raise exception/i);
  assert.match(
    hotfix,
    /on conflict on constraint auction_purchase_offers_product_id_offer_round_key/i,
  );
  assert.match(
    hotfix,
    /create or replace function public\.get_my_second_chance_offers\(\)[\s\S]*language plpgsql[\s\S]*volatile/i,
  );

  assert.match(repository, /rpc\("get_my_second_chance_offers"/);
  assert.match(repository, /rpc\("claim_my_second_chance_offer"/);
  assert.match(repository, /rpc\("decline_my_second_chance_offer"/);
  assert.match(gate, /차순위 구매 기회가 열렸습니다/);
  assert.match(gate, /Date\.parse\(offer\.expiresAt\) - Date\.parse\(offer\.offeredAt\)/);
  assert.match(gate, /거절에는 경고가 부과되지 않습니다/);
  assert.match(gate, /declineConfirmationOfferId/);
  assert.match(gate, /<Modal/);
  assert.match(account, /product\.paymentDueAt/);
  assert.match(account, /서버 시각 기준/);
  assert.match(account, /product\.purchaseOfferKind === "second_chance"/);
});

test("parses only explicit garment centimetres and keeps the bid submit contract intact", async () => {
  const measurements = await import(
    new URL("../src/utils/productMeasurements.ts", import.meta.url)
  );
  const explicit = measurements.parseProductMeasurements(
    "100 / 추천 M / 가슴단면 56cm / 총장 72.5cm / 어깨 48cm / 소매 61cm",
  );
  assert.deepEqual(explicit, {
    chestWidthCm: 56,
    totalLengthCm: 72.5,
    shoulderWidthCm: 48,
    sleeveLengthCm: 61,
  });
  assert.deepEqual(
    measurements.parseProductMeasurements("95 / 추천 M / 상태 좋음"),
    {},
  );
  assert.deepEqual(
    measurements.parseProductMeasurements("가슴단면 999cm / 총장 -2cm"),
    {},
  );

  const comparisons = measurements.compareGarmentMeasurements(explicit, {
    chestWidthCm: 54,
    totalLengthCm: 73.5,
    shoulderWidthCm: 48,
    sleeveLengthCm: 60,
    updatedAt: "2026-07-18T00:00:00.000Z",
  });
  assert.equal(comparisons.find((item) => item.key === "chestWidthCm")?.delta, 2);
  assert.equal(comparisons.find((item) => item.key === "totalLengthCm")?.delta, -1);
  assert.equal(comparisons.find((item) => item.key === "shoulderWidthCm")?.description, "거의 동일");

  const [scanner, hook, card, bidModal] = await Promise.all([
    source("src/components/feed/SizeComparisonScanner.tsx"),
    source("src/hooks/useGarmentSizeProfile.ts"),
    source("src/components/feed/PostCard.tsx"),
    source("src/components/feed/BidFormModal.tsx"),
  ]);
  assert.match(hook, /nnv:garment-profile:v1:/);
  assert.match(hook, /window\.localStorage/);
  assert.match(hook, /window\.sessionStorage/);
  assert.match(hook, /export function clearGarmentSizeProfile/);
  assert.match(scanner, /서버나 운영자에게 전송되지 않습니다/);
  assert.match(scanner, /측정 위치, 원단 신축성/);
  assert.match(card, /내 옷과 실측 비교하기/);
  assert.match(bidModal, /입찰 전 내 옷과 실측 비교/);
  assert.match(bidModal, /onSubmit=\{onSubmit\}/);
});
