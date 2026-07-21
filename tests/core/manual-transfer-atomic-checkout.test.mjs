import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, rootUrl), "utf8");
}

function functionBody(sql, name) {
  const marker = `create or replace function public.${name}`;
  const start = sql.toLowerCase().lastIndexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = sql.indexOf("$$;", start);
  assert.notEqual(end, -1, `${name} body must terminate`);
  return sql.slice(start, end + 3);
}

test("manual-transfer checkout creates the order and transfer in one RPC transaction", async () => {
  const migration = await source(
    "supabase/migrations/20260721141000_atomic_manual_transfer_checkout.sql",
  );
  const wrapper = functionBody(
    migration,
    "create_commerce_manual_transfer_checkout",
  );

  assert.match(
    wrapper,
    /v_order\s*:=\s*app_private\.create_commerce_order\s*\(/i,
  );
  assert.match(
    wrapper,
    /v_transfer\s*:=\s*public\.create_commerce_order_transfer\s*\(\s*v_order_id\s*\)/i,
  );
  assert.match(
    wrapper,
    /v_transfer\s*->>\s*'order_id'\s+is\s+distinct\s+from\s+v_order_id::text/i,
  );
  assert.match(
    wrapper,
    /from\s+public\.commerce_order_transfers[\s\S]{0,160}where\s+transfers\.order_id\s*=\s*v_order_id[\s\S]{0,160}if\s+found/i,
  );
  assert.match(
    wrapper,
    /jsonb_build_object\s*\(\s*'order'\s*,\s*v_order\s*,\s*'transfer'\s*,\s*v_transfer/i,
  );
  assert.match(
    migration,
    /alter\s+function\s+public\.create_commerce_order\s*\(\s*uuid\[\]\s*,\s*text\s*,\s*boolean\s*\)\s+set\s+schema\s+app_private/i,
  );
  assert.match(
    migration,
    /revoke\s+all\s+on\s+function\s+app_private\.create_commerce_order\s*\(\s*uuid\[\]\s*,\s*text\s*,\s*boolean\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i,
  );
  assert.match(
    migration,
    /grant\s+execute\s+on\s+function\s+public\.create_commerce_manual_transfer_checkout\s*\(\s*uuid\[\]\s*,\s*text\s*,\s*boolean\s*\)\s+to\s+authenticated/i,
  );
  const compatibilityWrapper = functionBody(migration, "create_commerce_order");
  assert.match(
    compatibilityWrapper,
    /public\.create_commerce_manual_transfer_checkout\s*\(/i,
  );
  assert.doesNotMatch(
    compatibilityWrapper,
    /insert\s+into\s+public\.commerce_orders/i,
  );
});

test("auction blackout permits only the exact fixed inventory close used by checkout", async () => {
  const migration = await source(
    "supabase/migrations/20260721142000_allow_fixed_checkout_during_auction_blackout.sql",
  );
  const guard = functionBody(migration, "guard_product_auction_blackout");

  assert.match(
    guard,
    /old\.sale_type\s*=\s*'fixed'[\s\S]*?new\.sale_type\s*=\s*'fixed'[\s\S]*?old\.status\s*=\s*'active'[\s\S]*?new\.status\s*=\s*'closed'/i,
  );
  assert.match(
    guard,
    /to_jsonb\(new\)\s*-\s*'status'\s*-\s*'updated_at'[\s\S]*?is\s+not\s+distinct\s+from[\s\S]*?to_jsonb\(old\)\s*-\s*'status'\s*-\s*'updated_at'/i,
  );
  assert.match(
    guard,
    /coalesce\(v_authoritative_bid_product_id,\s*''\)\s*<>\s*new\.id::text[\s\S]*?and\s+not\s+v_exact_fixed_inventory_close/i,
  );
  assert.match(
    guard,
    /new\.status\s+is\s+distinct\s+from\s+old\.status[\s\S]*?new\.final_bid_amount\s+is\s+distinct\s+from\s+old\.final_bid_amount/i,
  );
  assert.match(
    migration,
    /revoke\s+all\s+on\s+function\s+public\.guard_product_auction_blackout\(\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i,
  );
});

test("checkout API uses only the atomic manual-transfer RPC", async () => {
  const route = await source("src/app/api/orders/checkout/route.ts");
  const start = route.indexOf("async function checkoutWithManualTransfer");
  const end = route.indexOf("async function checkoutWithPortOne", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const manualCheckout = route.slice(start, end);

  assert.match(
    manualCheckout,
    /auth\.user\.rpc\(\s*"create_commerce_manual_transfer_checkout"/,
  );
  assert.doesNotMatch(
    manualCheckout,
    /auth\.user\.rpc\(\s*"create_commerce_order"/,
  );
  assert.doesNotMatch(
    manualCheckout,
    /auth\.user\.rpc\(\s*"create_commerce_order_transfer"/,
  );
  assert.match(
    manualCheckout,
    /const\s+checkout\s*=\s*readManualTransferCheckout\(data\)[\s\S]*?if\s*\(!checkout\)/,
  );
});

test("cart keeps its request and items until a complete transfer response is verified", async () => {
  const cart = await source("src/components/features/commerce/CartView.tsx");
  const transferCheck = cart.indexOf(
    "if (!isCheckoutTransfer(checkout.transfer, checkout.order))",
  );
  const removeCart = cart.indexOf("removePurchasedFromCart(productIds)");
  const clearRequest = cart.indexOf("clearStoredCheckoutRequest()", removeCart);

  assert.notEqual(transferCheck, -1);
  assert.ok(transferCheck < removeCart);
  assert.ok(removeCart < clearRequest);
  assert.match(
    cart,
    /transfer\.order_id\s*===\s*order\.id[\s\S]*?transfer\.expected_amount\s*===\s*order\.total[\s\S]*?awaiting_transfer[\s\S]*?partially_paid[\s\S]*?confirmed/,
  );
  assert.doesNotMatch(
    cart,
    /내 정보에서 입금 상태를 확인해 주세요/,
  );
});

test("database types expose the atomic checkout RPC", async () => {
  const types = await source("src/lib/supabase/database.types.ts");
  assert.match(
    types,
    /create_commerce_manual_transfer_checkout:\s*\{[\s\S]{0,180}p_idempotency_key:\s*string[\s\S]{0,120}p_product_ids:\s*string\[\]/,
  );
});
