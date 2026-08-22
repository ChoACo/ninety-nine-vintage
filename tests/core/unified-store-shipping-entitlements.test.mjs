import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("shop checkout quotes immediate and vault shipping from the same center entitlement source", async () => {
  const [route, cart] = await Promise.all([
    source("src/app/api/cart/route.ts"),
    source("src/components/features/commerce/CartView.tsx"),
  ]);

  assert.match(route, /shipping_fee_waiver_entitlements/);
  assert.match(route, /status", "available"/);
  assert.match(route, /vaultShippingFee/);
  assert.match(cart, /selectedShippingFee/);
  assert.match(cart, /잔여 배송권이 없는 센터 배송비/);
  assert.match(cart, /선결제 배송권 적용/);
});

test("database checkout charges immediate shipping and grants tokens only for vault prepayment", async () => {
  const migration = await source(
    "supabase/migrations/20260822195048_unify_store_shipping_entitlements.sql",
  );

  assert.match(migration, /apply_commerce_checkout_shipping_fee_all_units/i);
  assert.match(
    migration,
    /not coalesce\(p_immediate_shipping, false\)[\s\S]*shipping_fee_waiver_entitlements/i,
  );
  assert.match(
    migration,
    /new\.shipping_fee > 0[\s\S]*and not new\.direct_ship/i,
  );
  assert.match(
    migration,
    /direct_ship = coalesce\(p_include_shipping_fee, false\)/i,
  );
  assert.match(
    migration,
    /get_my_auction_payment_quote\(\)[\s\S]*begin_my_combined_auction_payment\(text,boolean,uuid\[\]\)/i,
  );
  assert.match(migration, /pg_get_functiondef/);
  assert.match(migration, /\(\.\|\\n\)\*\?/);
  assert.doesNotMatch(migration, /user_store_shipping_credits/i);
});

test("vault shipment remains atomic and consumes one available center token before creating a fee payment", async () => {
  const [migration, route] = await Promise.all([
    source(
      "supabase/migrations/20260724063531_simplify_direct_store_fulfillment.sql",
    ),
    source("src/app/api/shipping/requests/route.ts"),
  ]);

  assert.match(
    migration,
    /shipping_fee_waiver_entitlements[\s\S]*status = 'available'[\s\S]*for update skip locked/i,
  );
  assert.match(
    migration,
    /set status = 'consumed', consumed_shipment_id = v_shipment/i,
  );
  assert.match(
    migration,
    /if v_method = 'manual_transfer'[\s\S]*insert into public\.shipping_fee_payments/i,
  );
  assert.match(route, /request_inventory_shipment/);
});
