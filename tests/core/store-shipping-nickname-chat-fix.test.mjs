import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("stores expose exactly regular and remote-area shipping settings", async () => {
  const [migration, operator, cart, checkout] = await Promise.all([
    source("supabase/migrations/20260813060607_add_store_regional_shipping_and_fix_support_roles.sql"),
    source("src/components/admin/operator/OperatorPlatformConsole.tsx"),
    source("src/app/api/cart/route.ts"),
    source("src/app/api/orders/checkout/route.ts"),
  ]);
  assert.match(migration, /regular_shipping_fee bigint/);
  assert.match(migration, /remote_area_shipping_fee bigint/);
  assert.match(migration, /configure_store_shipping_fees/);
  assert.match(migration, /p_shipping_region not in \('regular','remote_area'\)/);
  assert.match(operator, /일반 택배/);
  assert.match(operator, /제주 및 도서산간/);
  assert.match(cart, /p_shipping_region: shippingRegion/);
  assert.match(checkout, /p_shipping_region: shippingRegion/);
});

test("nickname review is Owner-only and support sends use a role-aware RPC", async () => {
  const [migration, route] = await Promise.all([
    source("supabase/migrations/20260813060607_add_store_regional_shipping_and_fix_support_roles.sql"),
    source("src/app/api/chat/route.ts"),
  ]);
  assert.match(migration, /get_pending_nickname_change_requests[\s\S]*if not public\.is_owner\(\)/i);
  assert.match(migration, /review_nickname_change_request[\s\S]*if not public\.is_owner\(\)/i);
  assert.match(migration, /c\.member_id=actor\.session_id/);
  assert.match(migration, /create or replace function public\.send_support_message/);
  assert.match(route, /\.rpc\("send_support_message"/);
  assert.doesNotMatch(route, /\.from\("support_messages"\)[\s\S]*\.insert/);
});
