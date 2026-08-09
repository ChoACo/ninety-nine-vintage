export type ProductGender = "여성" | "남성" | "공용";

export interface ProductEnhancement {
  enhancedTitle: string;
  brand: string;
  gender: ProductGender;
  categoryId: string | null;
  categoryLabel: string | null;
  sizeLabel: string;
  refinedDescription: string;
  hashtags: string[];
}

/**
 * AI 보정 요청의 최종 결과 상태 계약입니다.
 * - success: 1차 모델이 유효한 보정 결과를 반환했습니다.
 * - partial_fallback: 일부 시도가 실패했지만 이후 모델이 유효한 결과를 반환했습니다.
 * - fallback: 모든 모델 시도가 실패해 원본 입력값으로 진행합니다 (정상 AI 성공으로 기록하지 않음).
 * - failed: 파이프라인 자체가 결과를 만들지 못했습니다 (잘못된 입력·쿼타·네트워크).
 */
export type ProductEnhancementStatus =
  | "success"
  | "partial_fallback"
  | "fallback"
  | "failed";

export interface AiEnhancementMeta {
  provider: "openrouter";
  model: string | null;
  attempts: number;
  attemptedModels: string[];
  fallbackReason: string | null;
  usageLogged: boolean;
}

export interface ProductEnhancementResult {
  status: ProductEnhancementStatus;
  enhancement: ProductEnhancement | null;
  ai: AiEnhancementMeta;
}

export function isAiEnhancementApplied(status: ProductEnhancementStatus): boolean {
  return status === "success" || status === "partial_fallback";
}

export interface ProductEnhancementSource {
  title: string;
  description?: string;
  condition?: string | null;
  categoryId?: string | null;
  sizeLabel?: string | null;
}

export interface ExcelEnhancementItem {
  rowNumber: number;
  images: readonly File[];
  source: ProductEnhancementSource;
}

export interface ExcelEnhancementResult {
  status: ProductEnhancementStatus;
  enhancement: ProductEnhancement | null;
  ai: AiEnhancementMeta;
  rowNumber: number;
}

interface EnhanceRequestOptions {
  accessToken: string;
  images: readonly File[];
  source: ProductEnhancementSource;
  storeId: string;
  signal?: AbortSignal;
}

/**
 * 사진은 최대 두 장만 전송합니다. API 키는 브라우저에 두지 않고 인증된
 * 서버 Route Handler가 모델(OpenRouter 경유 Gemini)을 호출합니다.
 */
export async function requestProductEnhancement({
  accessToken,
  images,
  source,
  storeId,
  signal,
}: EnhanceRequestOptions): Promise<ProductEnhancementResult> {
  const formData = new FormData();
  formData.set("source", JSON.stringify(source));
  formData.set("storeId", storeId);
  images.slice(0, 2).forEach((image) => formData.append("images", image));

  const failedResult = (fallbackReason: string | null): ProductEnhancementResult => ({
    status: "failed",
    enhancement: null,
    ai: {
      provider: "openrouter",
      model: null,
      attempts: 0,
      attemptedModels: [],
      fallbackReason,
      usageLogged: false,
    },
  });

  try {
    const response = await fetch("/api/admin/operator/products/enhance", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
      signal,
    });
    const payload = await response.json().catch(() => null) as {
      status?: ProductEnhancementStatus;
      enhancement?: ProductEnhancement | null;
      ai?: AiEnhancementMeta;
      error?: string;
    } | null;
    const status = payload?.status;
    const ai = payload?.ai;
    const validStatus = status === "success" || status === "partial_fallback" || status === "fallback";
    const validMeta = ai?.provider === "openrouter" &&
      (typeof ai.model === "string" || ai.model === null) &&
      Number.isSafeInteger(ai.attempts) && ai.attempts >= 0 &&
      Array.isArray(ai.attemptedModels) &&
      ai.attemptedModels.every((model) => typeof model === "string") &&
      (typeof ai.fallbackReason === "string" || ai.fallbackReason === null) &&
      typeof ai.usageLogged === "boolean";
    if (response.ok && payload?.enhancement && validStatus && validMeta && ai) {
      return {
        status,
        enhancement: payload.enhancement,
        ai,
      };
    }
    // 네트워크·쿼타·인식 오류는 등록을 막지 않고 기존 입력값을 유지합니다.
    return failedResult(payload?.error ?? null);
  } catch {
    return failedResult("network_error");
  }
}

/** 간편등록 사진 선택 시 상품명·성별 등 안전한 자동 입력 후보를 반환합니다. */
export function processQuickRegistrationAI(
  images: readonly File[],
  source: ProductEnhancementSource,
  accessToken: string,
  storeId: string,
  signal?: AbortSignal,
) {
  return requestProductEnhancement({ accessToken, images, source, storeId, signal });
}

/**
 * Excel 상품을 정해진 동시성으로 처리합니다. 한 행의 실패가 다른 행이나
 * 원본 검증 결과를 손상시키지 않도록 각 작업을 독립적으로 격리합니다.
 */
export async function processExcelWithAI(
  items: readonly ExcelEnhancementItem[],
  accessToken: string,
  storeId: string,
  options: {
    concurrency?: number;
    onProgress?: (completed: number, total: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<ExcelEnhancementResult[]> {
  const concurrency = Math.min(10, Math.max(1, options.concurrency ?? 5));
  const results: ExcelEnhancementResult[] = new Array(items.length);
  let cursor = 0;
  let completed = 0;

  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index];
      const result = await requestProductEnhancement({
        accessToken,
        images: item.images,
        source: item.source,
        storeId,
        signal: options.signal,
      });
      results[index] = { ...result, rowNumber: item.rowNumber };
      completed += 1;
      options.onProgress?.(completed, items.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}
