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

function extractSqlFunctionDefinition(migration, qualifiedName) {
  const escapedName = qualifiedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const definition = migration.match(
    new RegExp(
      `create or replace function ${escapedName}\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  )?.[0];
  assert.ok(definition, `${qualifiedName} definition must exist`);
  return definition.replaceAll("\r\n", "\n");
}

function replaceSqlFragmentExactlyOnce(source, before, after, label) {
  const pieces = source.split(before);
  assert.equal(
    pieces.length,
    2,
    `${label} must match exactly once in the canonical processor`,
  );
  return `${pieces[0]}${after}${pieces[1]}`;
}

test("auction countdown and soft close remain anchored to the database clock", async () => {
  const [migration, boundaryMigration, clockHook, integrationVerifier] = await Promise.all([
    source(
      "supabase/migrations/20260718102000_live_auction_revenue_defense.sql",
    ),
    source(
      "supabase/migrations/20260721070000_include_exact_three_minute_soft_close.sql",
    ),
    source("src/hooks/useAuctionPolicyClock.ts"),
    source("scripts/verify-integrations.mjs"),
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
    integrationVerifier,
    /supabase:auction-clock-rpc[\s\S]*publicAccess: true/,
  );
  assert.match(
    clockHook,
    /serverOffsetMs = serverTime - \(requestedAt \+ receivedAt\) \/ 2/,
  );
});

test("cart migration keeps saved fixed-price items without inventory holds", async () => {
  const migration = await source(
    "supabase/migrations/20260819160109_cart_list_without_holds.sql",
  );

  assert.match(migration, /alter column reserved_until drop not null/i);
  assert.match(migration, /drop index if exists public\.cart_items_product_reservation_key/i);
  assert.match(migration, /grant select, insert, update, delete on table public\.cart_items to authenticated/i);
  assert.match(
    migration,
    /create or replace function public\.reserve_fixed_product_for_cart\([\s\S]*p\.sale_type = 'fixed'/i,
  );
  assert.doesNotMatch(migration, /interval '15 minutes'/i);
  assert.match(migration, /delete from public\.cart_items where product_id = new\.product_id and member_id = v_member_id/i);
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
  assert.match(route, /if \(purchasableIds\.length === 0\)/);
  assert.match(route, /staleProductIds: ids/);
});

test("auction settlement blackout no longer blocks product uploads", async () => {
  const migration = await source(
    "supabase/migrations/20260821124657_remove_auction_upload_settlement_blackout.sql",
  );
  const definition = extractSqlFunctionDefinition(
    migration,
    "public.guard_product_auction_blackout",
  );
  assert.match(definition, /begin\s+return new;\s+end;/i);
  assert.doesNotMatch(definition, /is_auction_blackout|정산 시간/i);
});

test("quick cart copy does not promise an inventory hold", async () => {
  const detailPanel = await source(
    "src/components/features/auction/detail/StickyBidPanel.tsx",
  );

  assert.match(detailPanel, /구매 가능 여부는 결제 시 다시 확인됩니다/);
  assert.doesNotMatch(detailPanel, /15분 동안 재고를 안전하게 점유/);
});

test("the storefront keeps cart membership independent from inventory availability", async () => {
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
  assert.match(detailPanel, /구매 가능 여부는 결제 시 다시 확인됩니다/);
  assert.doesNotMatch(cartView, /15분 동안/);
  assert.doesNotMatch(cartView, /reservationExpired/);
  assert.match(cartView, /channel\("member-cart-product-events"\)/);
  assert.match(cartView, /cartIdsRef\.current\.includes\(productId\)/);
});

test("operator retry is an exact product-scoped mirror of the scheduled offer processor", async () => {
  const [canonicalMigration, scopedMigration] = await Promise.all([
    source(
      "supabase/migrations/20260718102000_live_auction_revenue_defense.sql",
    ),
    source(
      "supabase/migrations/20260721080000_scope_operator_second_chance_processing.sql",
    ),
  ]);

  const canonical = extractSqlFunctionDefinition(
    canonicalMigration,
    "public.process_auction_purchase_offers",
  );
  let expected = replaceSqlFragmentExactlyOnce(
    canonical,
    `create or replace function public.process_auction_purchase_offers(
  p_at timestamptz default clock_timestamp()
)`,
    `create or replace function app_private.process_auction_purchase_offer_for_product(
  p_product_id uuid,
  p_at timestamptz
)`,
    "scoped processor signature",
  );
  expected = replaceSqlFragmentExactlyOnce(
    expected,
    `begin
  if p_at is null then`,
    `begin
  if p_product_id is null then
    raise exception using
      errcode = '22023',
      message = '세컨드 찬스를 처리할 경매를 선택해 주세요.';
  end if;
  if p_at is null then`,
    "scoped processor argument guard",
  );
  expected = replaceSqlFragmentExactlyOnce(
    expected,
    `  where products.status = 'closed'`,
    `  where products.id = p_product_id
    and products.status = 'closed'`,
    "offer seeding scope",
  );
  expected = replaceSqlFragmentExactlyOnce(
    expected,
    `  where offers.status in ('payment_due', 'accepted')
    and exists (`,
    `  where offers.product_id = p_product_id
    and offers.status in ('payment_due', 'accepted')
    and exists (`,
    "settlement reconciliation scope",
  );
  expected = replaceSqlFragmentExactlyOnce(
    expected,
    `    from public.auction_purchase_offers as offers
    where offers.status = 'offered'`,
    `    from public.auction_purchase_offers as offers
    where offers.product_id = p_product_id
      and offers.status = 'offered'`,
    "unaccepted offer expiry scope",
  );
  expected = replaceSqlFragmentExactlyOnce(
    expected,
    `    from public.auction_purchase_offers as offers
    where offers.status in ('payment_due', 'accepted')`,
    `    from public.auction_purchase_offers as offers
    where offers.product_id = p_product_id
      and offers.status in ('payment_due', 'accepted')`,
    "payment deadline scope",
  );

  const scoped = extractSqlFunctionDefinition(
    scopedMigration,
    "app_private.process_auction_purchase_offer_for_product",
  );
  assert.equal(
    scoped,
    expected,
    "the operator processor may differ from the scheduled processor only by its target argument and four product filters",
  );

  const operatorWrapper = extractSqlFunctionDefinition(
    scopedMigration,
    "public.operator_process_second_chance",
  );
  assert.match(
    operatorWrapper,
    /app_private\.process_auction_purchase_offer_for_product\(\s*p_product_id,\s*v_now\s*\)/i,
  );
  assert.doesNotMatch(
    operatorWrapper,
    /public\.process_auction_purchase_offers\(/i,
  );
  assert.match(
    scopedMigration,
    /revoke all on function\s+app_private\.process_auction_purchase_offer_for_product\(uuid, timestamptz\)\s+from public, anon, authenticated, service_role/i,
  );
  assert.doesNotMatch(
    scopedMigration,
    /grant execute on function\s+app_private\.process_auction_purchase_offer_for_product/i,
  );
  assert.match(
    scopedMigration,
    /comment on function public\.operator_process_second_chance\(uuid\) is\s+'Owner\/operator assigned-store, product-scoped retry/i,
  );
});

test("operator second chance is role, store, deadline, audit, and payment-mode constrained", async () => {
  const [migration, route, consoleSource, pastConsole, pastRoute, button] =
    await Promise.all([
      source(
        "supabase/migrations/20260721080000_scope_operator_second_chance_processing.sql",
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
    /v_processed := app_private\.process_auction_purchase_offer_for_product\(\s*p_product_id,\s*v_now\s*\)/i,
  );
  assert.match(migration, /auction\.second_chance\.processed/i);
  assert.match(
    migration,
    /grant execute on function public\.operator_process_second_chance\(uuid\)\s+to authenticated/i,
  );

  assert.match(route, /authenticateOperatorStoreRequest\(request, true\)/);
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
  assert.doesNotMatch(route, /get_payment_runtime_mode_for_service|portone/i);
  assert.match(
    consoleSource,
    /canMutate &&\s*product\.sale_type === "auction" &&\s*product\.status === "closed"/,
  );
  assert.doesNotMatch(consoleSource, /paymentMode|portone/i);
  assert.match(consoleSource, /<OperatorSecondChanceButton/);
  assert.match(
    pastRoute,
    /\.eq\("sale_type", "auction"\)[\s\S]*\.eq\("status", "closed"\)/,
  );
  assert.match(pastRoute, /\.in\("store_id", storeIds\)/);
  assert.match(pastRoute, /closedAuctions:/);
  assert.match(pastConsole, /closedAuctions\.map/);
  assert.match(pastConsole, /최근 8개 제한 없이/);
  assert.doesNotMatch(pastConsole, /paymentMode|portone/i);
  assert.match(pastConsole, /<OperatorSecondChanceButton/);
  assert.doesNotMatch(pastConsole, /closedAuctions\.slice\(/);
  assert.match(
    button,
    />\s*<RefreshCcw[\s\S]*?\{processing \? "처리 중" : "차순위 낙찰 제안"\}\s*<\/button>/,
  );
  assert.match(button, /method: "POST"/);
});

test("abuse-limit migration caps live cart holds at three and schedules minute cleanup", async () => {
  const migration = await source(
    "supabase/migrations/20260807000000_cart_reservation_abuse_limits.sql",
  );

  const reserveDefinition = extractSqlFunctionDefinition(
    migration,
    "public.reserve_fixed_product_for_cart",
  );
  assert.match(
    reserveDefinition,
    /select count\(\*\)[\s\S]*from public\.cart_items as cart_items[\s\S]*where cart_items\.member_id = v_user_id[\s\S]*and cart_items\.reserved_until > clock_timestamp\(\)/i,
  );
  assert.match(
    reserveDefinition,
    /if v_active_hold_count >= 3 then[\s\S]*errcode = 'P0001'[\s\S]*message = '한 번에 최대 3개의 상품만 점유할 수 있습니다\.'/i,
  );
  assert.match(
    reserveDefinition,
    /from public\.products as products[\s\S]*for update/i,
  );

  assert.match(
    migration,
    /create or replace function public\.purge_expired_cart_reservations\([\s\S]*delete from public\.cart_items as cart_items[\s\S]*where cart_items\.reserved_until <= p_at/i,
  );
  assert.match(
    migration,
    /cron\.schedule\(\s*'purge-expired-cart-reservations',\s*'\* \* \* \* \*'/i,
  );
});
