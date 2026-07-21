import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("operator revenue ledger is a first-class route backed by the guarded RPC repository", async () => {
  await access(new URL("src/app/(admin)/admin/operator/revenue/page.tsx", rootUrl));
  const [layout, dashboard, revenue] = await Promise.all([
    source("src/app/(admin)/admin/operator/layout.tsx"),
    source("src/components/admin/operator/OperatorConsole.tsx"),
    source("src/components/admin/operator/OperatorRevenueConsole.tsx"),
  ]);

  assert.match(layout, /href:\s*"\/admin\/operator\/revenue"/);
  assert.match(dashboard, /href="\/admin\/operator\/revenue"/);
  assert.match(revenue, /getDailyRevenue\("2000-01-01",\s*today\)/);
  assert.match(revenue, /upsertDailyRevenue\(\{/);
  assert.match(revenue, /@\/components\/ui\/Button/);
  assert.match(revenue, /@\/components\/ui\/FormControls/);
  assert.match(revenue, /grid grid-cols-2[^"]*lg:grid-cols-4/);
  assert.match(revenue, /grid grid-cols-1[^"]*sm:grid-cols-2[^"]*xl:grid-cols-\[180px_1fr_180px_auto\]/);
  assert.match(revenue, /grid grid-cols-1 gap-8 xl:grid-cols-\[1fr_280px\]/);
});

test("operator product console restores controlled publishing and schedule metadata", async () => {
  const [products, productRoute, patchRoute, bulkRoute, publishRoute, publishMigration, mutationMigration, databaseTypes] = await Promise.all([
    source("src/components/admin/operator/OperatorProductsConsole.tsx"),
    source("src/app/api/admin/operator/products/route.ts"),
    source("src/app/api/admin/operator/products/[id]/route.ts"),
    source("src/app/api/admin/operator/products/bulk/route.ts"),
    source("src/app/api/admin/operator/products/[id]/publish/route.ts"),
    source("supabase/migrations/20260721020000_harden_operator_product_publishing.sql"),
    source("supabase/migrations/20260721030000_harden_operator_product_mutations.sql"),
    source("src/lib/supabase/database.types.ts"),
  ]);

  assert.match(products, /selectedPendingIds/);
  assert.match(products, /publishProductNow\(token, id\)/);
  assert.match(products, /shouldPublishAfterSave\s*\?\s*"pending"\s*:\s*form\.status/);
  assert.match(products, /expectedUpdatedAt:\s*editingId\s*\?\s*editingUpdatedAt/);
  assert.match(products, /result\.published_count\s*===\s*1/);
  assert.match(products, /result\.skipped_count\s*===\s*0/);
  assert.match(products, /result\.published_ids\.includes\(productId\)/);
  assert.match(products, /setSelectedPendingIds\(new Set\(failedIds\)\)/);
  assert.match(products, /method:\s*"POST"/);
  assert.match(products, /publishAt, closesAt/);
  assert.match(products, /inspectionNotes:\s*splitLines/);
  assert.match(products, /measurements:\s*\{/);
  assert.match(products, /type="datetime-local"/);
  assert.match(products, /body:\s*JSON\.stringify\(\{\s*expectedUpdatedAt:\s*product\.updated_at\s*\}\)/);
  assert.match(products, /disabled=\{busy \|\| !permissions\.canMutate \|\| product\.status !== "pending"\}/);
  assert.match(products, /status:\s*"pending" \| "active";/);
  assert.match(products, /permissions\.canPublish && form\.status === "active"/);
  assert.match(products, /permissions\.canPublish && <option value="active">즉시 공개<\/option>/);
  assert.match(products, /disabled=\{busy \|\| !permissions\.canPublish \|\| product\.status !== "pending"\}/);
  assert.match(products, /grid grid-cols-1 gap-3[^"]*sm:grid-cols-2/);
  assert.match(products, /grid grid-cols-2 gap-2[^"]*lg:grid-cols-4/);
  assert.match(products, /grid grid-cols-1 gap-3 sm:grid-cols-3/);

  assert.doesNotMatch(productRoute, /getCatalogImageUrl/);
  assert.match(productRoute, /products:\s*products \?\? \[\]/);
  assert.match(productRoute, /auth\.user\.from\("products"\)\.insert/);
  assert.match(productRoute, /store\.operator_id !== auth\.effectiveOperatorId/);
  assert.match(productRoute, /const canMutate = auth\.roleCode === "owner" \|\| auth\.roleCode === "operator"/);
  assert.match(productRoute, /permissions:\s*\{ canCreate: true, canMutate, canPublish: canMutate \}/);
  assert.match(bulkRoute, /auth\.user[\s\S]*\.from\("products"\)[\s\S]*\.insert/);

  assert.match(patchRoute, /validInteger\(body\.startingPrice, MAX_PRODUCT_PRICE\)/);
  assert.match(patchRoute, /validInteger\(body\.bidIncrement, MAX_BID_INCREMENT\)/);
  assert.match(patchRoute, /validTimestampVersion\(body\.expectedUpdatedAt\)/);
  assert.match(patchRoute, /product\.status === "closed"/);
  assert.match(patchRoute, /product\.status !== "pending"/);
  assert.match(patchRoute, /publish_endpoint_required/);
  assert.match(patchRoute, /auth\.user[\s\S]*\.rpc\("update_operator_product"/);
  assert.match(patchRoute, /sameUrls\(imageUrls, product\.image_urls\)/);
  assert.match(patchRoute, /p_thumbnail_urls:\s*thumbnailUrls/);
  assert.match(patchRoute, /validTimestampVersion\(body\?\.expectedUpdatedAt\)/);
  assert.match(patchRoute, /storagePathFromProductImageUrl/);
  assert.match(patchRoute, /parsedUrl\.origin !== new URL\(configuredUrl\)\.origin/);
  assert.match(patchRoute, /segments\[1\] === productId/);
  assert.match(patchRoute, /segments\[2\] === "images" \|\| segments\[2\] === "thumbnails"/);
  assert.match(patchRoute, /auth\.admin\.storage[\s\S]*\.remove\(storagePaths\)/);
  assert.doesNotMatch(patchRoute, /auth\.admin[\s\S]*\.from\("products"\)[\s\S]*\.update\(/);

  assert.match(mutationMigration, /for update;/i);
  assert.match(mutationMigration, /can_manage_product_store\(v_product\.store_id\)/);
  assert.match(mutationMigration, /reports_to_operator_id\s*=\s*stores\.operator_id/);
  assert.match(mutationMigration, /v_product\.updated_at\s*<>\s*p_expected_updated_at/);
  assert.match(mutationMigration, /v_product\.status\s*<>\s*'pending'/);
  assert.match(mutationMigration, /status\s*=\s*'pending'/);
  assert.equal((mutationMigration.match(/v_role not in \('owner', 'operator'\)/g) ?? []).length, 2);
  assert.match(mutationMigration, /revoke all on function public\.update_managed_product/);
  assert.match(mutationMigration, /grant execute on function public\.update_operator_product[\s\S]*to authenticated/i);
  assert.match(mutationMigration, /\/storage\/v1\/render\/image\/public\//);
  assert.match(mutationMigration, /split_part\(images\.url, '\?', 1\)/);
  assert.match(mutationMigration, /\/storage\/v1\/object\/public\//);
  assert.match(mutationMigration, /old\.sale_type is distinct from new\.sale_type/);
  assert.match(databaseTypes, /can_manage_product_store:/);
  assert.match(databaseTypes, /update_operator_product:/);

  assert.match(publishRoute, /store\?\.operator_id !== auth\.userId/);
  assert.match(publishRoute, /auth\.roleCode !== "owner" && auth\.roleCode !== "operator"/);
  assert.match(publishRoute, /\.rpc\("publish_pending_products_now"/);
  assert.match(publishRoute, /\.single\(\)/);
  assert.match(publishRoute, /data\.published_count === 1/);
  assert.match(publishRoute, /data\.skipped_count === 0/);
  assert.match(publishRoute, /product_not_published/);

  assert.match(publishMigration, /v_role\s*=\s*'owner'/);
  assert.match(publishMigration, /stores\.operator_id\s*=\s*v_actor/);
  assert.match(publishMigration, /stores\.is_active/);
  assert.match(publishMigration, /products\.status\s*=\s*'pending'/);
  assert.match(publishMigration, /auction_feed_expires_at\s*=\s*case/);
  assert.match(publishMigration, /from public, anon, authenticated, service_role/i);
  assert.match(publishMigration, /grant execute[\s\S]*to authenticated/i);
});

test("owner products use the same canonical and optimistic product-management path", async () => {
  const [page, route, patchRoute, bulkRoute] = await Promise.all([
    source("src/app/(admin)/admin/owner/products/page.tsx"),
    source("src/app/api/admin/owner/products/route.ts"),
    source("src/app/api/admin/owner/products/[id]/route.ts"),
    source("src/app/api/admin/owner/products/bulk/route.ts"),
  ]);

  assert.match(page, /OperatorProductsConsole/);
  assert.doesNotMatch(page, /OwnerProductsConsole/);
  assert.match(route, /GET as getManagedProducts/);
  assert.match(route, /POST as createManagedProduct/);
  assert.match(route, /auth\.roleCode === "owner"/);
  assert.match(patchRoute, /PATCH as updateManagedProduct/);
  assert.match(patchRoute, /auth\.roleCode !== "owner"/);
  assert.match(bulkRoute, /POST as createManagedProducts/);
  assert.match(bulkRoute, /auth\.roleCode !== "owner"/);
  for (const ownerRoute of [route, patchRoute, bulkRoute]) {
    assert.doesNotMatch(ownerRoute, /auth\.admin\.from\("products"\)/);
    assert.doesNotMatch(ownerRoute, /getCatalogImageUrl/);
  }
});

test("operator settlement and shipping remain server-authoritative after the UI restoration", async () => {
  const [orders, shipping] = await Promise.all([
    source("src/components/admin/operator/OperatorOrdersConsole.tsx"),
    source("src/components/admin/operator/OperatorShippingConsole.tsx"),
  ]);

  assert.match(orders, /\/api\/admin\/operator\/transfers\/\$\{transfer\.id\}\/ledger/);
  assert.match(orders, /action:\s*"record"/);
  assert.match(orders, /action:\s*"reverse"/);
  assert.match(shipping, /fetch\("\/api\/admin\/operator\/shipping"/);
  assert.doesNotMatch(orders, /\.from\("(?:commerce_order_transfers|manual_transfer_payment_ledger)"/);
  assert.doesNotMatch(shipping, /\.from\("shipping_requests"/);
});
