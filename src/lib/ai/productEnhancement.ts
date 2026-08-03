export type ProductGender = "여성" | "남성" | "공용";

export interface ProductEnhancement {
  enhancedTitle: string;
  brand: string;
  gender: ProductGender;
  categoryId: string | null;
  categoryLabel: string | null;
  refinedDescription: string;
  hashtags: string[];
}

export interface ProductEnhancementSource {
  title: string;
  description?: string;
  condition?: string | null;
  categoryId?: string | null;
}

export interface ExcelEnhancementItem {
  rowNumber: number;
  images: readonly File[];
  source: ProductEnhancementSource;
}

export interface ExcelEnhancementResult {
  enhancement: ProductEnhancement | null;
  rowNumber: number;
}

interface EnhanceRequestOptions {
  accessToken: string;
  images: readonly File[];
  source: ProductEnhancementSource;
  signal?: AbortSignal;
}

/**
 * 사진은 최대 두 장만 전송합니다. API 키는 브라우저에 두지 않고 인증된
 * 서버 Route Handler가 Gemini를 호출합니다.
 */
export async function requestProductEnhancement({
  accessToken,
  images,
  source,
  signal,
}: EnhanceRequestOptions): Promise<ProductEnhancement | null> {
  const formData = new FormData();
  formData.set("source", JSON.stringify(source));
  images.slice(0, 2).forEach((image) => formData.append("images", image));

  try {
    const response = await fetch("/api/admin/operator/products/enhance", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
      signal,
    });
    const payload = await response.json().catch(() => null) as {
      enhancement?: ProductEnhancement;
    } | null;
    return response.ok ? payload?.enhancement ?? null : null;
  } catch {
    // 네트워크·쿼타·인식 오류는 등록을 막지 않고 기존 입력값을 유지합니다.
    return null;
  }
}

/**
 * Excel 상품을 정해진 동시성으로 처리합니다. 한 행의 실패가 다른 행이나
 * 원본 검증 결과를 손상시키지 않도록 각 작업을 독립적으로 격리합니다.
 */
export async function processExcelWithAI(
  items: readonly ExcelEnhancementItem[],
  accessToken: string,
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
      const enhancement = await requestProductEnhancement({
        accessToken,
        images: item.images,
        source: item.source,
        signal: options.signal,
      });
      results[index] = { enhancement, rowNumber: item.rowNumber };
      completed += 1;
      options.onProgress?.(completed, items.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

/** 간편등록 사진 선택 시 상품명·성별 등 안전한 자동 입력 후보를 반환합니다. */
export function processQuickRegistrationAI(
  images: readonly File[],
  source: ProductEnhancementSource,
  accessToken: string,
  signal?: AbortSignal,
) {
  return requestProductEnhancement({ accessToken, images, source, signal });
}
