import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { processExcelWithAI } from "../../src/lib/ai/productEnhancement.ts";
import { cleanupExpiredStorageRecords } from "../../src/lib/multicloud/cleanup.ts";

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
    if (current === 3) return Response.json({ error: "quota", status: "failed" }, { status: 429 });
    return Response.json({
      status: "success",
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
      ai: {
        provider: "openrouter",
        model: "google/gemini-3.5-flash",
        attempts: 1,
        attemptedModels: ["google/gemini-3.5-flash"],
        fallbackReason: null,
        usageLogged: true,
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
    assert.equal(results[3].status, "failed");
    assert.equal(results[3].enhancement, null);
    assert.equal(results[3].ai.fallbackReason, "quota");
    assert.equal(results[0].status, "success");
    assert.equal(results[0].enhancement?.enhancedTitle, "보정 0");
    assert.ok(maximumActive <= 5);
    assert.ok(maximumActive > 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gemini route is server authenticated and keeps a safe fallback boundary", async () => {
  const [route, enhancer, consoleSource, modal, quotaMigration, statusMigration, tokenTracker] = await Promise.all([
    source("src/app/api/admin/operator/products/enhance/route.ts"),
    source("src/lib/ai/GeminiProductEnhancer.server.ts"),
    source("src/components/admin/operator/OperatorProductsConsole.tsx"),
    source("src/components/admin/operator/OperatorXlsxImportModal.tsx"),
    source("supabase/migrations/20260803151227_reserve_gemini_product_enhancement_daily_quota.sql"),
    source("supabase/migrations/20260808120000_add_ai_usage_status_column.sql"),
    source("src/lib/ai/tokenTracker.ts"),
  ]);
  assert.match(route, /authenticateOperatorStoreRequest\(request, true\)/);
  assert.match(route, /product_enhancement_unavailable/);
  assert.match(route, /status:\s*"failed"/);
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
  // Step 5: AI 결과 상태 계약 (success / partial_fallback / fallback / failed)
  assert.match(enhancer, /"partial_fallback"/);
  assert.match(enhancer, /status: "fallback"/);
  assert.match(enhancer, /usageLogged/);
  assert.match(enhancer, /attemptedModels/);
  assert.match(enhancer, /logTokenUsage/);
  assert.match(consoleSource, /isAiEnhancementApplied/);
  assert.match(modal, /isAiEnhancementApplied/);
  assert.match(statusMigration, /ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'success'/);
  assert.match(statusMigration, /IN \('success', 'partial_fallback', 'fallback', 'failed'\)/);
  assert.match(tokenTracker, /status:\s*input\.status \?\? "success"/);
  assert.match(tokenTracker, /Promise<boolean>/);
});

test("multi-provider reference code stays isolated while runtime registers only evidenced storage providers", async () => {
  const [contracts, router, cleanup, adapters, productService, factory, migration, retirement] = await Promise.all([
    source("src/lib/multicloud/contracts.ts"),
    source("src/lib/multicloud/MultiProviderRouter.ts"),
    source("src/lib/multicloud/BatchCleanupScheduler.ts"),
    source("src/lib/multicloud/adapters.ts"),
    source("src/lib/multicloud/ProductService.ts"),
    source("src/lib/multicloud/factory.ts"),
    source("supabase/migrations/20260804000000_create_multi_provider_records.sql"),
    source("supabase/migrations/20260809041957_retire_multicloud_raw_sql_executor.sql"),
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
  assert.match(factory, /getConfiguredStorageAdapters/);
  assert.match(factory, /R2_ACCOUNT_ID/);
  assert.doesNotMatch(factory, /S3CompatibleStorageAdapter|GcsStorageAdapter|multi_provider_records_exec/);
  assert.match(migration, /create table if not exists public\.multi_provider_records/);
  assert.match(migration, /multi_provider_records_exec/);
  assert.match(migration, /revoke all on table[\s\S]*multi_provider_records/);
  assert.match(retirement, /drop function if exists app_private\.multi_provider_records_exec/);
  assert.match(retirement, /get_multicloud_storage_usage/);
  assert.match(retirement, /grant execute[\s\S]*to service_role/);
});

test("storage cleanup deletes objects before locators and preserves failures for retry", async () => {
  const events = [];
  const adapters = new Map([
    ["supabase", {
      id: "supabase",
      delete: async (key) => events.push(`object:${key}`),
    }],
  ]);
  const report = await cleanupExpiredStorageRecords([
    { id: "row-1", storage_provider_id: "supabase", storage_key: "products/one" },
    { id: "row-2", storage_provider_id: "r2", storage_key: "products/two" },
  ], adapters, async (id) => events.push(`locator:${id}`));

  assert.deepEqual(events, ["object:products/one", "locator:row-1"]);
  assert.equal(report.scanned, 2);
  assert.equal(report.deleted, 1);
  assert.deepEqual(report.failed, [{
    id: "row-2",
    providerId: "r2",
    reason: "storage_provider_not_configured",
  }]);
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
  assert.match(service, /get_multicloud_storage_usage/);
  assert.match(service, /storage_provider_id/);
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
