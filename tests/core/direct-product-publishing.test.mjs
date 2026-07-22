import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("draft publication uses explicit store permission and has no approval actor", async () => {
  const [migration, route] = await Promise.all([
    source("supabase/migrations/20260722130000_activate_direct_product_publishing.sql"),
    source("src/app/api/admin/operator/products/[id]/publish/route.ts"),
  ]);

  assert.match(
    migration,
    /has_store_permission\(products\.store_id,\s*'publish_products'\)/i,
  );
  assert.match(migration, /status\s*=\s*'active'/i);
  assert.match(migration, /publish_at\s*=\s*v_now/i);
  assert.match(migration, /updated_by\s*=\s*v_actor/i);
  assert.match(migration, /grant execute[\s\S]{0,180}to authenticated/i);
  assert.doesNotMatch(migration, /v_role\s+text|role\s+in\s*\('owner',\s*'operator'\)/i);

  assert.match(route, /auth\.user[\s\S]{0,120}\.rpc\("publish_pending_products_now"/);
  assert.doesNotMatch(route, /roleCode|operator_id/);
});

test("product management treats pending as a draft and keeps one batch input", async () => {
  const [consoleSource, xlsxSource, productsRoute] = await Promise.all([
    source("src/components/admin/operator/OperatorProductsConsole.tsx"),
    source("src/components/admin/operator/OperatorXlsxImportModal.tsx"),
    source("src/app/api/admin/operator/products/route.ts"),
  ]);

  assert.match(consoleSource, /status:\s*"active"/);
  assert.match(consoleSource, /초안으로 저장/);
  assert.match(consoleSource, /await publishProductNow\(token, productId\)/);
  assert.match(consoleSource, /점검·하자 메모/);
  assert.doesNotMatch(consoleSource, /실측|measurementShoulder|measurements:\s*\{/);
  assert.doesNotMatch(consoleSource, /parseBulkCsv|일괄 등록 CSV|CSV 일괄 등록 실행/);
  assert.match(xlsxSource, /등록이 끝난 상품은 즉시 공개됩니다/);
  assert.match(productsRoute, /from\("store_memberships"\)/);
  assert.match(productsRoute, /p_permission:\s*"manage_products"/);
  assert.match(productsRoute, /const canMutate = stores\.length > 0/);
  assert.match(consoleSource, /product\.store_id !== null && publishableStoreIds\.has\(product\.store_id\)/);
  assert.match(consoleSource, /store\.id === product\.store_id && store\.canPublish/);
});

test("permissioned staff can edit and delete draft or active products without a role-name gate", async () => {
  const migration = await source("supabase/migrations/20260722152316_restore_published_product_management.sql");

  assert.match(migration, /create or replace function public\.update_operator_product/i);
  assert.match(migration, /create or replace function public\.delete_managed_product/i);
  assert.match(migration, /has_store_permission\(v_product\.store_id,\s*'manage_products'\)/i);
  assert.match(migration, /has_store_permission\(p_store_id,\s*'manage_products'\)/i);
  assert.match(migration, /status not in \('pending', 'active'\)/i);
  assert.doesNotMatch(migration, /v_role\s+text|v_role\s+not\s+in/i);
});
