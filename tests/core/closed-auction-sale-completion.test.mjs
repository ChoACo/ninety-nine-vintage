import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("closed winners remain public until inventory marks the sale complete", async () => {
  const [migration, products, feedCard] = await Promise.all([
    source("supabase/migrations/20260724082849_align_closed_sale_inventory_and_tracking.sql"),
    source("src/services/products.ts"),
    source("src/components/features/auction/AuctionFeedCard.tsx"),
  ]);

  assert.match(migration, /add column if not exists sale_completed_at timestamptz/);
  assert.match(migration, /mark_product_sale_completed_from_inventory/);
  assert.match(
    migration,
    /status = 'closed'[\s\S]*sale_completed_at is null/,
  );
  assert.match(
    migration,
    /get_public_sold_feed_products[\s\S]*products\.sale_completed_at is not null/,
  );
  assert.match(
    products,
    /and\(status\.eq\.closed,final_bid_id\.not\.is\.null,final_bid_amount\.not\.is\.null,sale_completed_at\.is\.null\)/,
  );
  assert.match(feedCard, /phase === "CLOSED" \? "마감됨" : "실시간 입찰"/);
});

test("shipping requests leave member storage and tracking deletion restores packed state", async () => {
  const [migration, api, operatorConsole, accountDashboard] = await Promise.all([
    source("supabase/migrations/20260724082849_align_closed_sale_inventory_and_tracking.sql"),
    source("src/app/api/admin/operator/shipping/route.ts"),
    source("src/components/admin/operator/OperatorShippingConsole.tsx"),
    source("src/components/features/account/AccountDashboard.tsx"),
  ]);

  const overview = migration.match(
    /create or replace function public\.get_my_inventory_overview[\s\S]*?(?=alter table public\.inventory_command_receipts)/,
  )?.[0] ?? "";
  assert.match(
    overview,
    /not exists \([\s\S]*inventory_shipment_items[\s\S]*line_status not in \('excluded', 'cancelled'\)/,
  );
  assert.match(migration, /create or replace function public\.revise_inventory_shipment_tracking/);
  assert.match(migration, /'tracking_deleted', 'shipped', 'packed'/);
  assert.match(migration, /set status = 'packed',[\s\S]*tracking_number = null/);
  assert.match(api, /action === "tracking_update"/);
  assert.match(api, /action === "tracking_delete"/);
  assert.match(operatorConsole, /발송 완료 내역/);
  assert.match(operatorConsole, /송장 수정/);
  assert.match(operatorConsole, /송장 삭제/);
  assert.match(accountDashboard, /신청 상품 \{shipment\.items\.length\}개 보기/);
});
