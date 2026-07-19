import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

function functionBody(sql, schema, name) {
  const pattern = new RegExp(
    `create or replace function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
    "i",
  );
  const match = sql.match(pattern);
  assert.ok(match, `missing SQL function ${schema}.${name}`);
  return match[0];
}

test("fixed-price schema is backwards compatible and enforces one sale contract", async () => {
  const migration = await source(
    "supabase/migrations/20260719110000_add_fixed_price_products.sql",
  );

  assert.match(
    migration,
    /sale_type text not null default 'auction'/i,
  );
  assert.match(migration, /fixed_price bigint/i);
  assert.match(
    migration,
    /products_sale_type_check[\s\S]*sale_type in \('auction', 'fixed'\)/i,
  );
  assert.match(
    migration,
    /products_fixed_price_contract_check[\s\S]*sale_type = 'auction'[\s\S]*fixed_price is null[\s\S]*sale_type = 'fixed'[\s\S]*fixed_price is not null[\s\S]*fixed_price between 1 and 1000000000/i,
  );
  assert.match(
    migration,
    /products_public_sale_feed_idx[\s\S]*\(sale_type, status, publish_at desc, id desc\)/i,
  );
  assert.match(
    migration,
    /create policy "Staff insert products"[\s\S]*can_manage_products[\s\S]*sale_type = 'fixed'[\s\S]*starting_price = fixed_price[\s\S]*current_price = fixed_price/i,
  );
});

test("fixed-price claim locks one product and reuses the immutable winner ledger", async () => {
  const migration = await source(
    "supabase/migrations/20260719110000_add_fixed_price_products.sql",
  );
  const claim = functionBody(
    migration,
    "public",
    "claim_fixed_price_product",
  );

  assert.match(claim, /security definer[\s\S]*set search_path = ''/i);
  assert.match(claim, /auth_user_has_kakao_identity\(v_user_id\)/i);
  assert.match(claim, /accounts\.account_status = 'active'/i);
  assert.match(claim, /access_role_for_user\(v_user_id\)[\s\S]*member[\s\S]*band_member/i);
  assert.match(claim, /from public\.products[\s\S]*for update/i);
  assert.match(claim, /v_product\.sale_type <> 'fixed'/i);
  assert.match(claim, /v_product\.status <> 'active'/i);
  assert.match(claim, /v_product\.publish_at > v_now/i);
  assert.match(claim, /exists \([\s\S]*from public\.auction_bids/i);
  assert.match(claim, /set_config\('app\.fixed_purchase_product_id'/i);
  assert.match(claim, /insert into public\.auction_bids/i);
  assert.match(claim, /is_final,[\s\S]*true,/i);
  assert.match(claim, /set_config\('app\.authoritative_bid_product_id'/i);
  assert.match(claim, /participant_count = 1/i);
  assert.match(claim, /bid_locked_at = v_now/i);
  assert.match(claim, /final_bid_id = v_bid_id/i);
  assert.match(claim, /final_bid_amount = v_product\.fixed_price/i);
  assert.match(claim, /status = 'closed'/i);
  assert.match(
    claim,
    /payment_runtime_settings[\s\S]*active_mode = 'manual_transfer'/i,
  );
  assert.match(
    claim,
    /offers\.offer_round \+ 1[\s\S]*from public\.auction_purchase_offers[\s\S]*order by offers\.offer_round desc/i,
  );
  assert.match(claim, /insert into public\.auction_purchase_offers/i);
  assert.match(claim, /'fixed_purchase'/i);
  assert.match(claim, /previous_offer_id/i);
  assert.match(
    claim,
    /returning id, offer_round[\s\S]*v_purchase_offer_id, v_purchase_offer_round/i,
  );
  assert.match(claim, /'purchase_offer_id', v_purchase_offer_id/i);
  assert.doesNotMatch(claim, /update public\.auction_purchase_offers/i);
  assert.doesNotMatch(claim, /delete from public\.auction_purchase_offers/i);
  assert.match(claim, /write_security_activity/i);
  assert.match(
    migration,
    /revoke all on function public\.claim_fixed_price_product\(uuid\)[\s\S]*from public, anon, authenticated, service_role[\s\S]*grant execute[\s\S]*to authenticated/i,
  );
});

test("fixed-price purchase rounds append offers while auction rounds stay exact", async () => {
  const [migration, revenueDefense, manualTransferHotfix] = await Promise.all([
    source("supabase/migrations/20260719110000_add_fixed_price_products.sql"),
    source("supabase/migrations/20260718102000_live_auction_revenue_defense.sql"),
    source("supabase/migrations/20260718103000_live_auction_revenue_defense_hotfix.sql"),
  ]);
  const normalize = functionBody(
    migration,
    "app_private",
    "normalize_fixed_purchase_offer",
  );
  const beginManualTransfer = functionBody(
    manualTransferHotfix,
    "public",
    "begin_manual_transfer",
  );

  assert.match(
    migration,
    /auction_purchase_offers_offer_round_check[\s\S]*offer_round between 1 and 2147483647/i,
  );
  assert.match(
    migration,
    /offer_kind = 'original' and offer_round = 1[\s\S]*offer_kind = 'second_chance' and offer_round = 2[\s\S]*offer_kind = 'fixed_purchase' and offer_round >= 1/i,
  );
  assert.match(
    migration,
    /offer_kind in \('original', 'fixed_purchase'\)[\s\S]*response_due_at is null/i,
  );
  assert.match(normalize, /v_sale_type = 'fixed'/i);
  assert.match(
    normalize,
    /offers\.offer_round \+ 1[\s\S]*order by offers\.offer_round desc/i,
  );
  assert.match(normalize, /new\.offer_kind := 'fixed_purchase'/i);
  assert.match(normalize, /new\.previous_offer_id := v_previous_offer_id/i);
  assert.match(
    normalize,
    /elsif new\.offer_kind = 'fixed_purchase'[\s\S]*경매 상품에는 정가 구매 offer를 생성할 수 없습니다/i,
  );
  assert.match(
    migration,
    /create trigger auction_purchase_offers_normalize_fixed_purchase[\s\S]*before insert on public\.auction_purchase_offers/i,
  );

  // The existing auction processor still grants round 2 only to an original
  // auction winner. Fixed offers therefore never enter second-chance logic.
  assert.match(
    revenueDefense,
    /if v_offer\.offer_kind = 'original' then[\s\S]*'second_chance'/i,
  );
  assert.match(
    beginManualTransfer,
    /offers\.bidder_id = v_user_id[\s\S]*offers\.status in \('payment_due', 'accepted', 'settled'\)/i,
  );
  assert.match(
    beginManualTransfer,
    /insert into public\.manual_transfer_orders[\s\S]*purchase_offer_id[\s\S]*v_offer\.id/i,
  );
  assert.match(
    revenueDefense,
    /status = 'cancelled_unpaid'[\s\S]*cancellation_reason = '입금 기한 초과'/i,
  );
  assert.match(
    revenueDefense,
    /manual_transfer_orders_live_product_idx[\s\S]*where status in \('awaiting_manual_transfer', 'confirmed'\)/i,
  );
});

test("normal bids cannot enter fixed products and instant publish keeps them open", async () => {
  const migration = await source(
    "supabase/migrations/20260719110000_add_fixed_price_products.sql",
  );
  const guard = functionBody(
    migration,
    "app_private",
    "guard_product_sale_type_bid",
  );
  const publish = functionBody(
    migration,
    "public",
    "publish_pending_products_now",
  );

  assert.match(guard, /products\.sale_type/i);
  assert.match(guard, /v_sale_type = 'fixed'/i);
  assert.match(guard, /app\.fixed_purchase_product_id/i);
  assert.match(guard, /raise exception/i);
  assert.match(
    migration,
    /create trigger auction_bids_guard_product_sale_type[\s\S]*before insert on public\.auction_bids/i,
  );
  const eligibility = functionBody(
    migration,
    "public",
    "enforce_member_bid_eligibility",
  );
  assert.match(
    eligibility,
    /app\.fixed_purchase_product_id[\s\S]*new\.product_id::text[\s\S]*return new/i,
  );
  assert.match(eligibility, /member_bid_sanctions/i);
  assert.match(
    publish,
    /when products\.sale_type = 'fixed'[\s\S]*9999-12-31/i,
  );

  const update = functionBody(
    migration,
    "public",
    "update_managed_product",
  );
  assert.match(update, /p_expected_updated_at/i);
  assert.match(update, /for update/i);
  assert.match(update, /v_product\.updated_at <> p_expected_updated_at/i);
  assert.match(update, /when v_product\.sale_type = 'fixed'[\s\S]*9999-12-31/i);
  assert.match(
    update,
    /fixed_price = case[\s\S]*when v_product\.sale_type = 'fixed' then p_starting_price[\s\S]*else null/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.update_managed_product\([\s\S]*from public, anon, authenticated, service_role[\s\S]*grant execute[\s\S]*to authenticated/i,
  );
});

test("returns an unpaid fixed-price product to the public shop after its only buyer is removed", async () => {
  const migration = await source(
    "supabase/migrations/20260719110000_add_fixed_price_products.sql",
  );

  assert.match(migration, /reopen_fixed_product_after_last_bid/);
  assert.match(
    migration,
    /after delete on public\.auction_bids[\s\S]*reopen_fixed_product_after_last_bid/,
  );
  assert.match(migration, /deferrable initially deferred/);
  assert.match(
    migration,
    /status = case[\s\S]*publish_at <= v_now then 'active'[\s\S]*else 'pending'/,
  );
  assert.match(
    migration,
    /closes_at = timestamptz '9999-12-31 23:59:59\+00'/,
  );
  assert.match(migration, /current_price = products\.fixed_price/);
  assert.match(migration, /participant_count = 0/);
  assert.match(migration, /bid_history = '\[\]'::jsonb/);
});

test("client types, queries, and operator registration keep auction and fixed lanes separate", async () => {
  const [types, database, products, modal, bulk, parser] = await Promise.all([
    source("src/types/auction.ts"),
    source("src/lib/supabase/database.types.ts"),
    source("src/lib/supabase/products.ts"),
    source("src/components/feed/NewAuctionModal.tsx"),
    source("src/components/admin/BulkAuctionImportModal.tsx"),
    source("src/lib/import/batchAuction.ts"),
  ]);

  assert.match(types, /ProductSaleType = "auction" \| "fixed"/);
  assert.match(types, /saleType: ProductSaleType/);
  assert.match(types, /fixedPrice: number \| null/);
  assert.match(database, /claim_fixed_price_product:/);
  assert.match(products, /"sale_type"/);
  assert.match(products, /"fixed_price"/);
  assert.match(products, /saleType: row\.sale_type === "fixed"/);
  assert.match(
    products,
    /fetchPublishedProductsPage[\s\S]*\.eq\("sale_type", "auction"\)/,
  );
  assert.match(
    products,
    /fetchPublishedFixedProductsPage[\s\S]*\.eq\("sale_type", "fixed"\)/,
  );
  assert.match(products, /export async function claimFixedPriceProduct/);
  assert.match(modal, /판매 방식/);
  assert.match(modal, /fixedPrice: saleType === "fixed" \? startingPrice : null/);
  assert.match(bulk, /Y열을 정가로 등록/);
  assert.match(bulk, /saleType,/);
  assert.match(parser, /fixedPrice: saleType === "fixed" \? row\.startingPrice : null/);
});

test("operator product management labels and filters fixed-price products without changing mutation contracts", async () => {
  const [adminPage, editModal] = await Promise.all([
    source("src/components/admin/AdminPage.tsx"),
    source("src/components/admin/ProductEditModal.tsx"),
  ]);

  assert.match(adminPage, /type ProductSaleTypeFilter = "all" \| ManagedProduct\["saleType"\]/);
  assert.match(adminPage, /value=\{productSaleTypeFilter\}/);
  assert.match(adminPage, /<option value="auction">라이브 경매<\/option>/);
  assert.match(adminPage, /<option value="fixed">상시 바로구매<\/option>/);
  assert.match(adminPage, /product\.saleType !== productSaleTypeFilter/);
  assert.match(adminPage, /fixed: "BUY NOW"/);
  assert.match(adminPage, /auction: "LIVE BID"/);
  assert.match(adminPage, /formatKRW\(managedProductPrice\(product\)\)/);
  assert.match(adminPage, /product\.saleType === "fixed"[\s\S]*판매 정가/);
  assert.match(adminPage, /product\.saleType === "fixed"[\s\S]*구매 확정/);
  assert.match(
    adminPage,
    /updateManagedProduct\(productId, \{[\s\S]*startingPrice: values\.startingPrice,[\s\S]*bidIncrement: currentProduct\.bidIncrement,[\s\S]*expectedUpdatedAt: currentProduct\.updatedAt/,
  );
  assert.match(adminPage, /deleteManagedProduct\(deletingProduct\.id, deletingProduct\.updatedAt\)/);
  assert.match(adminPage, /handlePublishPendingProducts/);

  assert.match(
    editModal,
    /product\.saleType === "fixed"[\s\S]*product\.fixedPrice \?\? product\.startingPrice/,
  );
  assert.match(editModal, /isFixedPrice \? "판매 정가" : "시작가"/);
  assert.match(editModal, /상시 바로구매 · 자동 마감 없음/);
  assert.match(editModal, /입찰 없이 표시된 판매 정가로 한 명만 구매할 수 있습니다/);
  assert.match(
    editModal,
    /await onSave\(product\.id, \{[\s\S]*title,[\s\S]*description,[\s\S]*status: form\.status,[\s\S]*publishAt,[\s\S]*startingPrice,[\s\S]*\}\)/,
  );
});
