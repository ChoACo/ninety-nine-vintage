import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/20260724062000_support_fixed_price_sold_product_detail.sql",
  import.meta.url,
);

test("sold detail supports completed fixed-price products without exposing buyer identity", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /products\.sale_type = 'fixed'/);
  assert.match(migration, /commerce_order_items/);
  assert.match(migration, /fixed_order\.unit_price/);
  assert.match(migration, /else '비공개'/);
  assert.match(migration, /grant execute on function public\.get_public_sold_product\(uuid\) to anon, authenticated/);
});

test("desktop and mobile sold details label fixed-price sales correctly", async () => {
  const desktop = await readFile(new URL("../../src/app/(shop)/sold/[id]/page.tsx", import.meta.url), "utf8");
  const mobile = await readFile(new URL("../../src/app/(mobile)/m/sold/[id]/page.tsx", import.meta.url), "utf8");

  assert.match(desktop, /product\.sale_type === "fixed" \? "판매가" : "낙찰가"/);
  assert.match(mobile, /product\.sale_type === "fixed" \? "판매가" : "낙찰가"/);
});
