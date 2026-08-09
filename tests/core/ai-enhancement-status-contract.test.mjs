import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isAiEnhancementApplied,
  processQuickRegistrationAI,
  requestProductEnhancement,
} from "../../src/lib/ai/productEnhancement.ts";

const root = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

const ENHANCEMENT = {
  enhancedTitle: "보정 상품명",
  brand: "빈티지",
  gender: "공용",
  categoryId: "100000",
  categoryLabel: "여성/티셔츠",
  sizeLabel: "M",
  refinedDescription: "보정 설명",
  hashtags: ["#빈티지"],
};

const META = (
  model = "google/gemini-3.5-flash",
  attempts = 1,
  fallbackReason = null,
  usageLogged = true,
) => ({ provider: "openrouter", model, attempts, fallbackReason, usageLogged });

function makeFile() {
  return new File([new Uint8Array([1])], "item.jpg", { type: "image/jpeg" });
}

function withFetch(responseFactory) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = responseFactory;
  return () => { globalThis.fetch = originalFetch; };
}

test("client maps success response to an applied enhancement", async () => {
  const restore = withFetch(async () => Response.json({
    status: "success",
    enhancement: ENHANCEMENT,
    ai: META(),
  }));
  try {
    const result = await requestProductEnhancement({
      accessToken: "token",
      images: [makeFile()],
      source: { title: "원본" },
      storeId: "00000000-0000-4000-8000-000000000000",
    });
    assert.equal(result.status, "success");
    assert.equal(result.enhancement?.enhancedTitle, "보정 상품명");
    assert.equal(result.ai.attempts, 1);
    assert.equal(result.ai.fallbackReason, null);
    assert.equal(result.ai.usageLogged, true);
    assert.equal(isAiEnhancementApplied(result.status), true);
  } finally {
    restore();
  }
});

test("client maps partial_fallback as applied with model and reason", async () => {
  const restore = withFetch(async () => Response.json({
    status: "partial_fallback",
    enhancement: ENHANCEMENT,
    ai: META("nvidia/nemotron-nano-12b-v2-vl:free", 2, "OpenRouter 429 rate limited", true),
  }));
  try {
    const result = await requestProductEnhancement({
      accessToken: "token",
      images: [makeFile()],
      source: { title: "원본" },
      storeId: "00000000-0000-4000-8000-000000000000",
    });
    assert.equal(result.status, "partial_fallback");
    assert.equal(result.ai.model, "nvidia/nemotron-nano-12b-v2-vl:free");
    assert.equal(result.ai.attempts, 2);
    assert.match(result.ai.fallbackReason ?? "", /429/);
    assert.equal(isAiEnhancementApplied(result.status), true);
  } finally {
    restore();
  }
});

test("client maps fallback 200 response as NOT applied while keeping original values", async () => {
  const restore = withFetch(async () => Response.json({
    status: "fallback",
    enhancement: ENHANCEMENT,
    ai: META(null, 3, "OpenRouter 503 service unavailable", false),
  }));
  try {
    const result = await requestProductEnhancement({
      accessToken: "token",
      images: [makeFile()],
      source: { title: "원본" },
      storeId: "00000000-0000-4000-8000-000000000000",
    });
    assert.equal(result.status, "fallback");
    assert.equal(isAiEnhancementApplied(result.status), false);
    assert.equal(result.ai.usageLogged, false);
    assert.ok(result.enhancement, "fallback는 원본값 스냅샷을 유지한다");
  } finally {
    restore();
  }
});

test("client maps quota-limited response to failed without enhancement", async () => {
  const restore = withFetch(async () => Response.json({
    error: "product_enhancement_daily_limit_reached",
    status: "failed",
    message: "오늘 이 센터의 AI 자동 보정 300건을 모두 사용했습니다.",
  }, { status: 429 }));
  try {
    const result = await requestProductEnhancement({
      accessToken: "token",
      images: [makeFile()],
      source: { title: "원본" },
      storeId: "00000000-0000-4000-8000-000000000000",
    });
    assert.equal(result.status, "failed");
    assert.equal(result.enhancement, null);
    assert.equal(result.ai.fallbackReason, "product_enhancement_daily_limit_reached");
    assert.equal(result.ai.attempts, 0);
    assert.equal(isAiEnhancementApplied(result.status), false);
  } finally {
    restore();
  }
});

test("client maps network failure to failed and never throws", async () => {
  const restore = withFetch(async () => { throw new TypeError("network down"); });
  try {
    const result = await requestProductEnhancement({
      accessToken: "token",
      images: [makeFile()],
      source: { title: "원본" },
      storeId: "00000000-0000-4000-8000-000000000000",
    });
    assert.equal(result.status, "failed");
    assert.equal(result.enhancement, null);
    assert.equal(result.ai.fallbackReason, "network_error");
    assert.equal(result.ai.usageLogged, false);
    assert.equal(isAiEnhancementApplied(result.status), false);
  } finally {
    restore();
  }
});

test("processQuickRegistrationAI propagates the result envelope", async () => {
  const restore = withFetch(async () => Response.json({
    status: "success",
    enhancement: ENHANCEMENT,
    ai: META(),
  }));
  try {
    const result = await processQuickRegistrationAI(
      [makeFile()],
      { title: "원본" },
      "token",
      "00000000-0000-4000-8000-000000000000",
    );
    assert.equal(result.status, "success");
    assert.ok(result.enhancement);
  } finally {
    restore();
  }
});

test("static AI status contract is consistent across router, enhancer, tracker and migration", async () => {
  const [router, enhancer, tracker, shared, migration, route] = await Promise.all([
    source("src/lib/ai/aiModelRouter.ts"),
    source("src/lib/ai/GeminiProductEnhancer.server.ts"),
    source("src/lib/ai/tokenTracker.ts"),
    source("src/lib/ai/productEnhancement.ts"),
    source("supabase/migrations/20260808120000_add_ai_usage_status_column.sql"),
    source("src/app/api/admin/operator/products/enhance/route.ts"),
  ]);
  assert.match(shared, /ProductEnhancementStatus =/);
  assert.match(shared, /"success"\s*\|\s*"partial_fallback"\s*\|\s*"fallback"\s*\|\s*"failed"/);
  assert.match(shared, /isAiEnhancementApplied/);
  assert.match(router, /export const PRIMARY_MODEL = "google\/gemini-3.5-flash"/);
  assert.match(router, /attemptedModels/);
  assert.match(router, /fallbackReason/);
  assert.match(router, /modelsTried/);
  assert.match(enhancer, /usedFallbackModel/);
  assert.match(enhancer, /status: "fallback"/);
  assert.match(enhancer, /provider: "openrouter"/);
  assert.match(tracker, /status\?: ProductEnhancementStatus/);
  assert.match(tracker, /row\.status !== "success" && row\.status !== "partial_fallback"/);
  assert.match(migration, /status TEXT NOT NULL DEFAULT 'success'/);
  assert.match(migration, /IN \('success', 'partial_fallback', 'fallback', 'failed'\)/);
  assert.match(route, /commerceJson\(result\)/);
});
