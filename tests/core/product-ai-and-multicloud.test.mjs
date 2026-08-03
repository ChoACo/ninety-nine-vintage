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
    const results = await processExcelWithAI(items, "token", { concurrency: 5 });
    assert.equal(results.length, 12);
    assert.equal(results[3].enhancement, null);
    assert.ok(maximumActive <= 5);
    assert.ok(maximumActive > 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gemini route is server authenticated and keeps a safe fallback boundary", async () => {
  const [route, enhancer, consoleSource, modal, quotaMigration, wrangler] = await Promise.all([
    source("src/app/api/admin/operator/products/enhance/route.ts"),
    source("src/lib/ai/GeminiProductEnhancer.server.ts"),
    source("src/components/admin/operator/OperatorProductsConsole.tsx"),
    source("src/components/admin/operator/OperatorXlsxImportModal.tsx"),
    source("supabase/migrations/20260803151227_reserve_gemini_product_enhancement_daily_quota.sql"),
    source("wrangler.jsonc"),
  ]);
  assert.match(route, /authenticateStaffRequest\(request, true\)/);
  assert.match(route, /product_enhancement_unavailable/);
  assert.match(enhancer, /response(?:Json)?Schema/);
  assert.match(enhancer, /gemini-3\.6-flash/);
  assert.doesNotMatch(enhancer, /temperature\s*:/);
  assert.match(enhancer, /getBatchClothingCategory/);
  assert.match(consoleSource, /processQuickRegistrationAI/);
  assert.match(modal, /concurrency: 5/);
  assert.match(route, /reserve_gemini_product_enhancement_quota/);
  assert.match(route, /product_enhancement_daily_limit_reached/);
  assert.match(quotaMigration, /timezone\('Asia\/Seoul', statement_timestamp\(\)\)::date/);
  assert.match(quotaMigration, /where usage\.request_count < 300/);
  assert.match(quotaMigration, /role\.role_code in \('owner', 'operator'\)/);
  assert.match(quotaMigration, /revoke all on table[\s\S]*from public, anon, authenticated/);
  assert.match(wrangler, /"region":\s*"gcp:asia-northeast1"/);
});

test("multi-provider pool encodes capacity routing, exact reads, circuit breaking, and file-first TTL", async () => {
  const [contracts, router, cleanup, adapters, productService] = await Promise.all([
    source("src/lib/multicloud/contracts.ts"),
    source("src/lib/multicloud/MultiProviderRouter.ts"),
    source("src/lib/multicloud/BatchCleanupScheduler.ts"),
    source("src/lib/multicloud/adapters.ts"),
    source("src/lib/multicloud/ProductService.ts"),
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
});
