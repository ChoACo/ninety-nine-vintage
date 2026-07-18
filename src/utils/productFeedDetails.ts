import type { AuctionPost } from "@/src/types/auction";

export interface ProductFeedDetails {
  isCanonical: boolean;
  name: string;
  size?: string;
  condition?: string;
  legacyDescription: string;
}

function labeledValue(line: string | undefined, label: RegExp) {
  const value = line?.match(label)?.[1]?.trim();
  return value || undefined;
}

/**
 * 일괄 등록 상품은 기존 products.description 컬럼에 Name/Size와 선택적인
 * 상품상태 줄을 저장합니다. 별도 DB 컬럼 없이도 구형 상품과 함께 표시할 수
 * 있도록 일반 설명을 안전한 대체값으로 사용합니다.
 */
export function getProductFeedDetails(
  product: Pick<AuctionPost, "title" | "description">,
): ProductFeedDetails {
  const title = product.title.trim();
  const legacyDescription = product.description.trim();
  const lines = legacyDescription
    .split(/\r?\n/)
    .map((line) => line.trim());

  const labeledName = labeledValue(lines[0], /^name\s*:\s*(.+)$/i);
  const labeledSize = labeledValue(lines[1], /^size\s*:\s*(.+)$/i);
  const labeledCondition = labeledValue(
    lines[2],
    /^상품\s*상태\s*:\s*(.+)$/,
  );
  const isCanonical = Boolean(
    labeledName &&
      labeledSize &&
      (lines.length === 2 || (lines.length === 3 && labeledCondition)),
  );
  const firstLine = lines.find(Boolean);

  return {
    isCanonical,
    name:
      (isCanonical ? labeledName : firstLine) ||
      title ||
      "구제 의류 상품",
    size: isCanonical ? labeledSize : undefined,
    condition: isCanonical ? labeledCondition : undefined,
    legacyDescription,
  };
}
