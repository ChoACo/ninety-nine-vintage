import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { processExcelWithAI } from "../../src/lib/ai/productEnhancement.ts";

const root = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("Excel AI enhancement limits concurrency and isolates failed rows", async () => {
  const originalFetch = globalThis.fetch;
  let active = 0;
  let maximumActive = 0;
  let request = 0;
  globalThis.fetch = async () => {
    const current = request++;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    if (current === 3) return Response.json({ error: "quota" }, { status: 429 });
    return Response.json({
      enhancement: {
        enhancedTitle: `보정 ${current}`,
        brand: "빈티지",
        gender: "공용",
        categoryId: null,
        categoryLabel: null,
        sizeLabel: "",
        refinedDescription: "보정 설명",
        hashtags: ["#빈티지"],
      },
    });
  };

  try {
    const file = new File([new Uint8Array([1])], "item.jpg", { type: "image/jpeg" });
    const items = Array.from({ length: 12 }, (_, index) => ({
      rowNumber: index + 6,
      images: [file],
      source: { title: `원본 ${index}` },
    }));
    const results = await processExcelWithAI(items, "token", "00000000-0000-4000-8000-000000000000", { concurrency: 5 });
    assert.equal(results.length, 12);
    assert.equal(results[3].enhancement, null);
    assert.ok(maximumActive <= 5);
    assert.ok(maximumActive > 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gemini route is server authenticated and keeps a safe fallback boundary", async () => {
  const [route, enhancer, consoleSource, modal, quotaMigration] = await Promise.all([
    source("src/app/api/admin/operator/products/enhance/route.ts"),
    source("src/lib/ai/GeminiProductEnhancer.server.ts"),
    source("src/components/admin/operator/OperatorProductsConsole.tsx"),
    source("src/components/admin/operator/OperatorXlsxImportModal.tsx"),
    source("supabase/migrations/20260803151227_reserve_gemini_product_enhancement_daily_quota.sql"),
  ]);
  assert.match(route, /authenticateStaffRequest\(request, true\)/);
  assert.match(route, /product_enhancement_unavailable/);
  assert.match(enhancer, /RESPONSE_JSON_SCHEMA/);
  assert.match(enhancer, /routeCompletion/);
  assert.match(enhancer, /aiModelRouter/);
  assert.match(enhancer, /getBatchClothingCategory/);
  assert.match(consoleSource, /processQuickRegistrationAI/);
  assert.match(modal, /processExcelWithAI/);
  assert.match(modal, /Gemini AI 자동 보정/);
  assert.match(route, /reserve_store_ai_quota/);
  assert.match(route, /storeId/);
  assert.match(enhancer, /size_label/);
  assert.match(route, /product_enhancement_daily_limit_reached/);
  assert.match(quotaMigration, /timezone\('Asia\/Seoul', statement_timestamp\(\)\)::date/);
  assert.match(quotaMigration, /where usage\.request_count < 300/);
  assert.match(quotaMigration, /role\.role_code in \('owner', 'operator'\)/);
  assert.match(quotaMigration, /revoke all on table[\s\S]*from public, anon, authenticated/);
});

test("multi-provider pool encodes capacity routing, exact reads, circuit breaking, and file-first TTL", async () => {
  const [contracts, router, cleanup, adapters, productService, factory, migration] = await Promise.all([
    source("src/lib/multicloud/contracts.ts"),
    source("src/lib/multicloud/MultiProviderRouter.ts"),
    source("src/lib/multicloud/BatchCleanupScheduler.ts"),
    source("src/lib/multicloud/adapters.ts"),
    source("src/lib/multicloud/ProductService.ts"),
    source("src/lib/multicloud/factory.ts"),
    source("supabase/migrations/20260804000000_create_multi_provider_records.sql"),
  ]);
  assert.match(contracts, /interface StorageAdapter/);
  assert.match(contracts, /interface DatabaseAdapter/);
  assert.match(router, /projected \/ usage\.capacityBytes >= this\.capacityThreshold/);
  assert.match(router, /storageProviderId/);
  assert.match(router, /dbProviderId/);
  assert.match(router, /CircuitBreaker/);
  assert.ok(cleanup.indexOf("await storage.delete(record.storageKey)") < cleanup.indexOf("await database.delete(record.id)"));
  assert.match(adapters, /class S3CompatibleStorageAdapter/);
  assert.match(adapters, /class GcsStorageAdapter/);
  assert.match(adapters, /class SupabaseStorageAdapter/);
  assert.match(adapters, /class PostgresDatabaseAdapter/);
  assert.match(productService, /this\.ttlDays \* 86_400_000/);
  assert.match(factory, /new SupabaseStorageAdapter\("supabase"/);
  assert.match(factory, /new PostgresDatabaseAdapter\("supabase"/);
  assert.match(factory, /new MultiProviderRouter\(storages, databases\)/);
  assert.match(factory, /multi_provider_records_exec/);
  assert.match(migration, /create table if not exists public\.multi_provider_records/);
  assert.match(migration, /multi_provider_records_exec/);
  assert.match(migration, /revoke all on table[\s\S]*multi_provider_records/);
});

test("storage usage gauge exposes provider capacity and an active rollover target", async () => {
  const [service, route, gauge, dashboard, aiMigration, productMigration, envExample] = await Promise.all([
    source("src/lib/multicloud/storageUsage.ts"),
    source("src/app/api/admin/owner/storage-usage/route.ts"),
    source("src/components/admin/owner/StorageUsageGauge.tsx"),
    source("src/components/admin/owner/OwnerDashboard.tsx"),
    source("supabase/migrations/20260804010000_create_ai_token_usage_logs.sql"),
    source("supabase/migrations/20260804020000_add_product_ai_metadata.sql"),
    source(".env.example"),
  ]);
  assert.match(service, /multi_provider_records_exec/);
  assert.match(service, /storage_provider_id/);
  assert.match(service, /pg_column_size/);
  assert.match(service, /totalUsedBytes/);
  assert.match(service, /rolloverThreshold/);
  assert.match(service, /activeProviderId/);
  assert.match(route, /authenticateStaffRequest/);
  assert.match(route, /roleCode !== "owner"/);
  assert.match(route, /getStorageUsageSummary/);
  assert.match(gauge, /StorageUsageGauge/);
  assert.match(gauge, /Active:/);
  assert.match(gauge, /bg-red-600/);
  assert.match(gauge, /bg-amber-500/);
  assert.match(gauge, /bg-emerald-600/);
  assert.match(dashboard, /StorageUsageGauge/);
  assert.match(dashboard, /TokenUsageGauge/);
  assert.match(aiMigration, /public\.ai_token_usage_logs/);
  assert.match(aiMigration, /account_access_roles/);
  assert.match(aiMigration, /role_code = 'owner'/);
  assert.match(productMigration, /ADD COLUMN IF NOT EXISTS enhanced_title/);
  assert.match(productMigration, /ADD COLUMN IF NOT EXISTS hashtags/);
  assert.match(envExample, /OPENROUTER_API_KEY/);
  assert.match(envExample, /CRON_SECRET/);
  assert.match(envExample, /MULTICLOUD_SUPABASE_CAPACITY_BYTES/);
});
