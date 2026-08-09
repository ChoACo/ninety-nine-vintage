import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const migration = () => readFile(new URL(
  "supabase/migrations/20260809160601_enforce_exact_logistics_permissions.sql",
  rootUrl,
), "utf8");

test("fulfillment groups grant only the exact requested logistics permission", async () => {
  const sql = await migration();
  const helper = sql.match(/create or replace function app_private\.has_exact_store_or_group_permission[\s\S]*?\n\$\$;/i)?.[0] ?? "";

  assert.match(helper, /when 'prepare_orders' then actor_membership\.prepare_orders/i);
  assert.match(helper, /when 'receive_at_center' then actor_membership\.receive_at_center/i);
  assert.match(helper, /when 'create_shipments' then actor_membership\.create_shipments/i);
  assert.doesNotMatch(helper, /prepare_orders\s+or|create_shipments\s+or/i);
});

test("store logistics never use owner or business-wide bypasses", async () => {
  const sql = await migration();
  const storePermission = sql.match(/create or replace function public\.has_store_permission[\s\S]*?\n\$\$;/i)?.[0] ?? "";
  const businessPermission = sql.match(/create or replace function public\.has_business_permission[\s\S]*?\n\$\$;/i)?.[0] ?? "";

  assert.match(storePermission, /then app_private\.has_exact_store_or_group_permission/i);
  assert.match(businessPermission, /'prepare_orders', 'receive_at_center', 'create_shipments', 'confirm_payments'[\s\S]*then false/i);
});
