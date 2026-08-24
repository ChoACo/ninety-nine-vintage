import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);

test("checkout snapshots one immutable charge per store or fulfillment group", async () => {
  const [migration, cartRoute, cartView] = await Promise.all([
    readFile(new URL("supabase/migrations/20260809165419_harden_checkout_shipping_unit_snapshots.sql", rootUrl), "utf8"),
    readFile(new URL("src/app/api/cart/route.ts", rootUrl), "utf8"),
    readFile(new URL("src/components/features/commerce/CartView.tsx", rootUrl), "utf8"),
  ]);

  for (const field of [
    "unit_kind",
    "unit_name",
    "billing_store_name",
    "included_store_ids",
    "included_product_ids",
    "product_subtotal",
  ]) {
    assert.match(migration, new RegExp(`add column ${field}`));
  }
  assert.match(migration, /unit_kind in \('store', 'fulfillment_group'\)/i);
  assert.match(migration, /commerce_shipping_allocation_immutable/i);
  assert.match(migration, /before update or delete/i);
  assert.match(migration, /v_requested_count <> \(select count\(distinct value\)/i);
  assert.match(migration, /'productSubtotal', v_product_total/i);
  assert.match(migration, /'total', v_product_total \+ v_shipping_total/i);
  assert.match(migration, /'billingStoreName'/i);
  assert.match(migration, /'productIds'/i);
  assert.match(cartRoute, /chargesAreValid/);
  assert.match(cartRoute, /auth\.user\.rpc\([\s\S]{0,100}"can_purchase_product"/);
  assert.match(cartRoute, /p_product_ids:\s*purchasableIds/);
  assert.match(cartRoute, /pendingLockByProductId/);
  assert.match(cartRoute, /\.neq\("member_id", auth\.userId\)/);
  assert.match(cartRoute, /visibleProductIds = \[[\s\S]*?\.\.\.purchasableIds,[\s\S]*?\.\.\.lockedProducts/);
  assert.match(cartRoute, /staleProductIds:\s*ids\.filter\(\(id\) => !visibleProductIdSet\.has\(id\)\)/);
  assert.match(cartRoute, /charge\.unitKind === "store"/);
  assert.match(cartView, /현재 계정으로 구매할 수 없는 상품/);
  assert.match(cartView, /다른 회원이 결제 진행 중 \(선점\)/);
  assert.match(cartView, /hasPendingProductLock/);
  assert.match(cartView, /처리\{" "\}[\s\S]*?\{charge\.billingStoreName\}/);
  assert.match(cartView, /charge\.products[\s\S]*?\.map/);
});
