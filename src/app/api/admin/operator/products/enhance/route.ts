import { GeminiProductEnhancer } from "@/lib/ai/GeminiProductEnhancer.server";
import type { ProductEnhancementSource } from "@/lib/ai/productEnhancement";
import { authenticateOperatorStoreRequest, commerceJson } from "@/lib/commerce/server";

export const runtime = "nodejs";

function parseSource(value: FormDataEntryValue | null): ProductEnhancementSource | null {
  if (typeof value !== "string" || value.length > 13_000) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed.title !== "string" || parsed.title.length > 160) return null;
    return {
      title: parsed.title,
      description: typeof parsed.description === "string" ? parsed.description : "",
      condition: typeof parsed.condition === "string" ? parsed.condition : null,
      categoryId: typeof parsed.categoryId === "string" ? parsed.categoryId : null,
      sizeLabel: typeof parsed.sizeLabel === "string" ? parsed.sizeLabel : null,
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const auth = await authenticateOperatorStoreRequest(request, true);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner" && auth.roleCode !== "operator") {
    return commerceJson({ error: "operator_products_forbidden" }, 403);
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) return commerceJson({ error: "invalid_form_data", status: "failed" }, 400);
  const source = parseSource(formData.get("source"));
  const storeId = formData.get("storeId");
  if (storeId !== auth.selectedStoreId) {
    return commerceJson({ error: "operator_store_scope_mismatch" }, 403);
  }
  const images = formData.getAll("images").filter(
    (entry): entry is File => entry instanceof File,
  ).slice(0, 2);
  if (!source || typeof storeId !== "string" || !/^[0-9a-f-]{36}$/i.test(storeId) || images.length === 0) {
    return commerceJson({ error: "invalid_enhancement_input", status: "failed" }, 400);
  }

  // 공급자 한도(10K RPD)보다 낮은 서비스 자체 300건/일 경계를 DB에서 원자적으로 예약합니다.
  // Gemini 호출이 실패해도 예약분은 반환하지 않아 반복 요청으로 비용 경계를 우회할 수 없습니다.
  const { data: quotaRows, error: quotaError } = await (
    auth.user as unknown as {
      rpc: (name: string, args: Record<string, unknown>) => Promise<{
        data: Array<{
          allowed: boolean;
          used: number;
          daily_limit: number | null;
          global_used: number;
          global_limit: number;
        }> | null;
        error: unknown;
      }>;
    }
  ).rpc("reserve_store_ai_quota", { p_store_id: storeId });
  if (quotaError || !quotaRows?.[0]) {
    console.error("[product-enhancement] quota reservation failed", quotaError);
    return commerceJson({
      error: "product_enhancement_quota_unavailable",
      status: "failed",
      message: "AI 일일 사용량을 확인하지 못해 기존 입력값을 유지합니다.",
    }, 503);
  }
  const quota = quotaRows[0];
  if (!quota.allowed) {
    return commerceJson({
      error: "product_enhancement_daily_limit_reached",
      status: "failed",
      message: quota.daily_limit === null
        ? "서비스 전체 AI 자동 보정 한도에 도달했습니다."
        : `오늘 이 센터의 AI 자동 보정 ${quota.daily_limit}건을 모두 사용했습니다.`,
      used: quota.used,
      dailyLimit: quota.daily_limit,
    }, 429);
  }

  try {
    const enhancer = new GeminiProductEnhancer();
    const result = await enhancer.enhance(source, images);
    return commerceJson(result);
  } catch (error) {
    // 구체적인 SDK/키/쿼타 오류를 클라이언트에 노출하지 않습니다.
    console.error("[product-enhancement] Gemini request failed", error);
    return commerceJson({
      error: "product_enhancement_unavailable",
      status: "failed",
      message: "AI 분석을 완료하지 못해 기존 입력값을 유지합니다.",
    }, 503);
  }
}
