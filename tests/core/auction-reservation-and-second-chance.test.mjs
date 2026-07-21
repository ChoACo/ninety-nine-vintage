import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

function extractPlaceBidDefinition(migration) {
  const definition = migration.match(
    /create or replace function public\.place_bid\([\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(definition, "place_bid definition must exist");
  return definition.replaceAll("\r\n", "\n");
}

test("auction countdown and soft close remain anchored to the database clock", async () => {
  const [migration, boundaryMigration, clockHook] = await Promise.all([
    source(
      "supabase/migrations/20260718102000_live_auction_revenue_defense.sql",
    ),
    source(
      "supabase/migrations/20260721070000_include_exact_three_minute_soft_close.sql",
    ),
    source("src/hooks/useAuctionPolicyClock.ts"),
  ]);

  const previousDefinition = extractPlaceBidDefinition(migration);
  const expectedBoundaryDefinition = previousDefinition.replace(
    "and v_product.closes_at - v_now < interval '3 minutes';",
    "and v_product.closes_at - v_now <= interval '3 minutes';",
  );
  assert.notEqual(expectedBoundaryDefinition, previousDefinition);
  assert.equal(
    extractPlaceBidDefinition(boundaryMigration),
    expectedBoundaryDefinition,
    "the exact-boundary migration must preserve every place_bid statement except < becoming <=",
  );

  assert.match(
    migration,
    /create or replace function public\.get_auction_server_time\(\)[\s\S]*select clock_timestamp\(\)/i,
  );
  assert.match(
    migration,
    /select products\.\* into v_product[\s\S]*where products\.id = p_product_id\s+for update/i,
  );
  assert.match(
    migration,
    /v_product\.closes_at - v_now < interval '3 minutes'/i,
  );
  assert.match(
    boundaryMigration,
    /v_product\.closes_at - v_now <= interval '3 minutes'/i,
  );
  assert.match(
    boundaryMigration,
    /revoke all on function public\.place_bid\(uuid, bigint\)\s+from public, anon, authenticated/i,
  );
  assert.match(
    boundaryMigration,
    /grant execute on function public\.place_bid\(uuid, bigint\)\s+to authenticated/i,
  );
  assert.match(
    migration,
    /when v_should_extend then v_now \+ interval '3 minutes'/i,
  );
  assert.match(
    migration,
    /anti_sniping_extension_count = v_product\.anti_sniping_extension_count\s*\+ case when v_should_extend then 1 else 0 end/i,
  );
  assert.match(clockHook, /rpc\("get_auction_server_time"\)/);
  assert.match(
    clockHook,
    /serverOffsetMs = serverTime - \(requestedAt \+ receivedAt\) \/ 2/,
  );
});

test("cart reservation migration installs a non-extendable exclusive 15-minute hold", async () => {
  const migration = await source(
    "supabase/migrations/20260721060000_auction_second_chance_and_cart_reservations.sql",
  );

  assert.match(
    migration,
    /alter table public\.cart_items[\s\S]*add column if not exists reserved_until timestamptz/i,
  );
  assert.match(
    migration,
    /create unique index if not exists cart_items_product_reservation_key\s+on public\.cart_items \(product_id\)/i,
  );
  assert.match(
    migration,
    /revoke insert, update, delete, truncate on table public\.cart_items\s+from anon, authenticated/i,
  );
  assert.match(
    migration,
    /create or replace function public\.reserve_fixed_product_for_cart\([\s\S]*from public\.products as products[\s\S]*for update/i,
  );
  assert.match(migration, /v_now \+ interval '15 minutes'/i);
  assert.match(
    migration,
    /Repeated clicks are idempotent and cannot extend an unexpired hold\.[\s\S]*return query select\s+v_reservation\.product_id,\s+v_reservation\.reserved_until/i,
  );
  assert.match(
    migration,
    /if found and v_reservation\.member_id <> v_member_id then[\s\S]*errcode = '23505'/i,
  );
  assert.match(
    migration,
    /create trigger commerce_order_items_consume_cart_reservation\s+before insert on public\.commerce_order_items/i,
  );
  assert.match(
    migration,
    /revoke execute on function public\.claim_fixed_price_product\(uuid\)\s+from anon, authenticated, service_role/i,
  );
});

test("cart API can only reserve and release inventory through authoritative RPCs", async () => {
  const route = await source("src/app/api/cart/route.ts");

  assert.match(route, /rpc\("get_my_cart_reservations"\)/);
  assert.match(route, /rpc\("reserve_fixed_product_for_cart"/);
  assert.match(route, /rpc\(\s*"release_my_cart_reservation"/);
  assert.doesNotMatch(route, /from\("cart_items"\)\.upsert/);
  assert.doesNotMatch(route, /from\("cart_items"\)[\s\S]{0,120}\.delete\(\)/);
  assert.match(route, /reservedUntil: data\.reserved_until/);
  assert.match(route, /serverTime: data\.server_time/);
});

test("the storefront surfaces the server-based 15-minute hold and blocks expired checkout", async () => {
  const [client, detailPanel, cartView] = await Promise.all([
    source("src/lib/commerce/client.ts"),
    source("src/components/features/auction/detail/StickyBidPanel.tsx"),
    source("src/components/features/commerce/CartView.tsx"),
  ]);

  assert.match(client, /export async function reserveCartProduct\(/);
  assert.match(
    client,
    /expectedUserId && session\.user\.id !== expectedUserId/,
  );
  assert.match(client, /method:\s*"POST"/);
  assert.match(client, /reservedUntil/);
  assert.match(
    detailPanel,
    /await reserveCartProduct\(item\.id, session\.user\.id\)/,
  );
  assert.match(detailPanel, /까지 15분간 재고가 점유됩니다/);
  assert.match(
    cartView,
    /const reservationNow = reservationClock \+ serverClockOffset/,
  );
  assert.match(
    cartView,
    /const reservationExpired\s*=\s*!hasPendingCheckout\s*&&\s*products\.some/,
  );
  assert.match(
    cartView,
    /서버 시간을 기준으로 15분 동안 내\s*계정에만 임시 점유됩니다/,
  );
  assert.match(
    cartView,
    /reservationExpired \|\|[\s\S]*paymentMode !== "manual_transfer"/,
  );
  assert.match(
    cartView,
    /aria-live="assertive"[\s\S]*재고 점유 시간이 만료되었습니다/,
  );
});

test("operator second chance is role, store, deadline, audit, and payment-mode constrained", async () => {
  const [migration, route, consoleSource, pastConsole, pastRoute, button] =
    await Promise.all([
      source(
        "supabase/migrations/20260721060000_auction_second_chance_and_cart_reservations.sql",
      ),
      source("src/app/api/admin/operator/auctions/[id]/second-chance/route.ts"),
      source("src/components/admin/operator/OperatorConsole.tsx"),
      source("src/components/admin/operator/OperatorPastProductsConsole.tsx"),
      source("src/app/api/admin/operator/products/past/route.ts"),
      source("src/components/admin/operator/OperatorSecondChanceButton.tsx"),
    ]);

  assert.match(
    migration,
    /create or replace function public\.operator_process_second_chance\(/i,
  );
  assert.match(migration, /v_role not in \('owner', 'operator'\)/i);
  assert.match(
    migration,
    /not public\.can_manage_product_store\(v_product\.store_id\)/i,
  );
  assert.match(
    migration,
    /v_original\.payment_due_at is null\s+or v_original\.payment_due_at > v_now/i,
  );
  assert.match(
    migration,
    /v_processed := public\.process_auction_purchase_offers\(v_now\)/i,
  );
  assert.match(migration, /auction\.second_chance\.processed/i);
  assert.match(
    migration,
    /grant execute on function public\.operator_process_second_chance\(uuid\)\s+to authenticated/i,
  );

  assert.match(route, /authenticateStaffRequest\(request, true\)/);
  assert.match(
    route,
    /auth\.roleCode !== "owner" && auth\.roleCode !== "operator"/,
  );
  assert.match(
    route,
    /auth\.user[\s\S]*\.rpc\("operator_process_second_chance"/,
  );
  assert.doesNotMatch(
    route,
    /auth\.admin\s*\.?\s*rpc\("operator_process_second_chance"/,
  );
  assert.match(
    route,
    /auth\.admin\.rpc\([\s\S]*"get_payment_runtime_mode_for_service"/,
  );
  assert.match(route, /paymentMode !== "manual_transfer"/);
  assert.match(route, /second_chance_manual_transfer_only/);
  assert.match(
    consoleSource,
    /canMutate &&\s*product\.sale_type === "auction" &&\s*product\.status === "closed"/,
  );
  assert.match(consoleSource, /<OperatorSecondChanceButton/);
  assert.match(
    pastRoute,
    /\.eq\("sale_type", "auction"\)[\s\S]*\.eq\("status", "closed"\)/,
  );
  assert.match(pastRoute, /\.in\("store_id", storeIds\)/);
  assert.match(pastRoute, /closedAuctions:/);
  assert.match(pastConsole, /closedAuctions\.map/);
  assert.match(pastConsole, /최근 8개 제한 없이/);
  assert.match(pastConsole, /paymentMode === "manual_transfer"/);
  assert.match(pastConsole, /<OperatorSecondChanceButton/);
  assert.doesNotMatch(pastConsole, /closedAuctions\.slice\(/);
  assert.match(
    button,
    />\s*<RefreshCcw[\s\S]*?\{processing \? "처리 중" : "차순위 낙찰 제안"\}\s*<\/button>/,
  );
  assert.match(button, /method: "POST"/);
});
