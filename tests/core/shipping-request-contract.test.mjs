import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const migrationUrl = new URL(
  "supabase/migrations/20260721050000_fix_shipping_payment_settlement_helper.sql",
  rootUrl,
);

test("shipping request uses the private settlement helper and preserves idempotency", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(
    migration,
    /create or replace function public\.request_product_shipping\(\s*p_product_ids uuid\[\],\s*p_address_id uuid,\s*p_apply_shipping_credit boolean,\s*p_idempotency_key text\s*\)/i,
  );
  assert.match(
    migration,
    /security definer\s+set search_path = ''[\s\S]*v_key text := nullif\(btrim\(p_idempotency_key\), ''\)/i,
  );
  assert.match(
    migration,
    /shipping_requests as requests[\s\S]*requests\.member_id = v_user_id and requests\.idempotency_key = v_key/i,
  );
  assert.match(
    migration,
    /pg_catalog\.pg_advisory_xact_lock\(\s*pg_catalog\.hashtextextended\(v_user_id::text \|\| ':' \|\| v_key, 0\)\s*\)/i,
  );
  assert.ok(
    migration.indexOf("pg_catalog.pg_advisory_xact_lock") <
      migration.indexOf("select requests.id into v_existing_request"),
    "the member/idempotency key must be locked before the first lookup",
  );
  assert.match(
    migration,
    /exception when unique_violation[\s\S]*requests\.idempotency_key = v_key[\s\S]*return v_existing_request/i,
  );
  assert.match(
    migration,
    /app_private\.is_product_payment_settled\(products\.id, v_user_id\)/i,
  );
  assert.doesNotMatch(
    migration,
    /public\.is_product_payment_settled\(/i,
  );
});

test("shipping request keeps the four, three, and two argument grants and wrappers", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  for (const signature of [
    "uuid\\[\\], uuid, boolean, text",
    "uuid\\[\\], uuid, boolean",
    "uuid\\[\\], uuid",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `revoke all on function public\\.request_product_shipping\\(${signature}\\)\\s+from public, anon, authenticated`,
        "i",
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `grant execute on function public\\.request_product_shipping\\(${signature}\\)\\s+to authenticated`,
        "i",
      ),
    );
  }

  assert.match(
    migration,
    /p_apply_shipping_credit boolean default true[\s\S]*language sql\s+security definer\s+set search_path = ''\s+as \$\$ select public\.request_product_shipping\(\$1, \$2, \$3, null\); \$\$/i,
  );
  assert.match(
    migration,
    /p_address_id uuid\s*\)\s*returns uuid\s+language sql\s+security definer\s+set search_path = ''\s+as \$\$ select public\.request_product_shipping\(\$1, \$2, true, null\); \$\$/i,
  );
});
