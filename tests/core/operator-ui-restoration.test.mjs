import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("operator revenue is summarized on the dashboard and retains a guarded detail route", async () => {
  await access(new URL("src/app/(admin)/admin/operator/revenue/page.tsx", rootUrl));
  const [layout, dashboard, route, revenue] = await Promise.all([
    source("src/app/(admin)/admin/operator/layout.tsx"),
    source("src/components/admin/operator/OperatorConsole.tsx"),
    source("src/app/api/admin/operator/revenue/route.ts"),
    source("src/components/admin/operator/OperatorRevenueConsole.tsx"),
  ]);

  assert.doesNotMatch(layout, /href:\s*"\/admin\/operator\/revenue"/);
  assert.match(dashboard, /href="\/admin\/operator\/revenue"/);
  assert.match(dashboard, /\/api\/admin\/operator\/revenue\?from=/);
  assert.match(dashboard, /이번 달 순매출/);
  assert.match(dashboard, /store\.netSales/);
  assert.match(route, /authenticateStaffRequest\(request\)/);
  assert.match(route, /auth\.user as unknown as RpcClient/);
  assert.match(route, /"get_store_financial_report"/);
  assert.match(route, /p_from:\s*from,\s*p_to:\s*to/);
  assert.match(route, /days\s*<\s*0\s*\|\|\s*days\s*>\s*365/);
  assert.match(route, /error\?\.code\s*===\s*"42501"/);
  assert.doesNotMatch(route, /auth\.admin[\s\S]*\.(?:update|insert|upsert|delete)\(/);

  assert.match(revenue, /new URLSearchParams\(\{\s*from,\s*to\s*\}\)/);
  assert.match(revenue, /\/api\/admin\/operator\/revenue\?\$\{query\}/);
  assert.match(revenue, /type="date"\s+value=\{from\}/);
  assert.match(revenue, /type="date"\s+value=\{to\}/);
  assert.match(revenue, /store\.storeName/);
  assert.match(revenue, /store\.grossSales/);
  assert.match(revenue, /store\.refunds/);
  assert.match(revenue, /store\.netSales/);
  assert.match(revenue, /centralShippingFees/);
  assert.doesNotMatch(revenue, /getDailyRevenue|upsertDailyRevenue/);
  assert.match(revenue, /grid grid-cols-2[^"]*lg:grid-cols-4/);
});

test("operator product console publishes directly and manages active listings from explicit store permission", async () => {
  const [products, productRoute, patchRoute, bulkRoute, publishRoute, publishMigration, mutationMigration, restoredManagementMigration, databaseTypes] = await Promise.all([
    source("src/components/admin/operator/OperatorProductsConsole.tsx"),
    source("src/app/api/admin/operator/products/route.ts"),
    source("src/app/api/admin/operator/products/[id]/route.ts"),
    source("src/app/api/admin/operator/products/bulk/route.ts"),
    source("src/app/api/admin/operator/products/[id]/publish/route.ts"),
    source("supabase/migrations/20260722130000_activate_direct_product_publishing.sql"),
    source("supabase/migrations/20260721030000_harden_operator_product_mutations.sql"),
    source("supabase/migrations/20260722152316_restore_published_product_management.sql"),
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
  assert.match(products, /publishAt,\s*closesAt/);
  assert.match(products, /inspectionNotes:\s*splitLines/);
  assert.doesNotMatch(products, /measurementShoulder|measurements:\s*\{/);
  assert.match(products, /type="datetime-local"/);
  assert.match(products, /body:\s*JSON\.stringify\(\{\s*expectedUpdatedAt:\s*product\.updated_at\s*\}\)/);
  assert.match(products, /function isManageableProductStatus\(status: string\)/);
  assert.match(products, /status === "pending" \|\| status === "active"/);
  assert.match(products, /edit\(product, "inspection"\)/);
  assert.match(products, /> 점검<\/button>/);
  assert.match(products, /사이트에서 즉시 사라집니다/);
  assert.match(products, /status:\s*"pending" \| "active";/);
  assert.match(products, /stores\.find\(\(store\) => store\.id === form\.storeId\)\?\.canPublish === true && form\.status === "active"/);
  assert.match(products, /form\.status === "active" \|\| stores\.find/);
  assert.match(products, /disabled=\{busy \|\| !canPublishStore \|\| product\.status !== "pending"\}/);
  assert.match(products, /\/products\/\$\{product\.id\}\/pause/);
  assert.match(products, /> 일시중지<\/button>/);
  assert.match(products, /grid grid-cols-1 gap-3[^"]*sm:grid-cols-2/);
  assert.doesNotMatch(products, /measurementShoulder|measurementChest|measurementSleeve|measurementLength/);
  assert.match(products, /grid grid-cols-1 gap-3 sm:grid-cols-3/);

  assert.doesNotMatch(productRoute, /getCatalogImageUrl/);
  assert.match(productRoute, /products:\s*products \?\? \[\]/);
  assert.match(productRoute, /auth\.user\.from\("products"\)\.insert/);
  assert.match(productRoute, /from\("store_memberships"\)/);
  assert.match(productRoute, /from\("fulfillment_center_staff_assignments"\)/);
  assert.match(productRoute, /home_fulfillment_center_id/);
  assert.match(productRoute, /p_permission:\s*"manage_products"/);
  assert.match(productRoute, /const canMutate = stores\.length > 0/);
  assert.match(productRoute, /canCreate:\s*stores\.length > 0/);
  assert.match(productRoute, /canPublish:\s*stores\.some\(\(store\) => store\.canPublish\)/);
  assert.match(bulkRoute, /auth\.user[\s\S]*\.from\("products"\)[\s\S]*\.insert/);

  assert.match(patchRoute, /validInteger\(body\.startingPrice, MAX_PRODUCT_PRICE\)/);
  assert.match(patchRoute, /validInteger\(body\.bidIncrement, MAX_BID_INCREMENT\)/);
  assert.match(patchRoute, /validTimestampVersion\(body\.expectedUpdatedAt\)/);
  assert.match(patchRoute, /product\.status !== "pending" && product\.status !== "active"/);
  assert.match(patchRoute, /product\.status === "active" && saleSetupFields\.some/);
  assert.match(patchRoute, /active_sale_setup_immutable/);
  assert.match(patchRoute, /publish_endpoint_required/);
  assert.doesNotMatch(patchRoute, /pending_product_required|normalizeMeasurements/);
  assert.match(patchRoute, /p_measurements:\s*product\.measurements/);
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

  assert.match(restoredManagementMigration, /v_product\.status not in \('pending', 'active'\)/i);
  assert.match(restoredManagementMigration, /v_product\.status = 'active'[\s\S]*p_store_id is distinct from v_product\.store_id/i);
  assert.match(restoredManagementMigration, /when v_product\.status = 'pending' then p_starting_price else current_price/i);
  assert.match(restoredManagementMigration, /create or replace function public\.delete_managed_product/i);
  assert.match(restoredManagementMigration, /when foreign_key_violation/i);
  assert.match(restoredManagementMigration, /from public, anon, authenticated, service_role/i);
  assert.match(restoredManagementMigration, /grant execute[\s\S]*to authenticated/i);

  assert.doesNotMatch(publishRoute, /operator_id|roleCode/);
  assert.match(publishRoute, /auth\.user[\s\S]*\.rpc\("publish_pending_products_now"/);
  assert.match(publishRoute, /\.rpc\("publish_pending_products_now"/);
  assert.match(publishRoute, /\.single\(\)/);
  assert.match(publishRoute, /data\.published_count === 1/);
  assert.match(publishRoute, /data\.skipped_count === 0/);
  assert.match(publishRoute, /product_not_published/);

  assert.match(publishMigration, /has_store_permission\(products\.store_id,\s*'publish_products'\)/);
  assert.doesNotMatch(publishMigration, /v_role|stores\.operator_id/);
  assert.match(publishMigration, /products\.status\s*=\s*'pending'/);
  assert.match(publishMigration, /publish_at\s*=\s*v_now/);
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
