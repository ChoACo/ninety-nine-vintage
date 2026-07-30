export type ProductFeedTagKind = "size" | "gender" | "year";

export interface ProductFeedTag {
  kind: ProductFeedTagKind;
  label: string;
}

interface ProductFeedTagInput {
  description?: string | null;
  gender?: string | null;
  size?: string | null;
}

const EXPLICIT_YEAR_PATTERN =
  /(?:^|[^\p{L}\p{N}])((?:19|20)\d{2})(?:\s*년(?:식|도)?)?(?=$|[^\p{L}\p{N}])/gu;

export function extractExplicitProductYear(
  description: string | null | undefined,
  maxYear = new Date().getFullYear(),
): number | null {
  if (!description) return null;
  for (const match of description.matchAll(EXPLICIT_YEAR_PATTERN)) {
    const year = Number(match[1]);
    if (year >= 1900 && year <= maxYear) return year;
  }
  return null;
}

export function getProductFeedTags(
  input: ProductFeedTagInput,
  maxYear?: number,
): ProductFeedTag[] {
  const tags: ProductFeedTag[] = [];
  const size = input.size?.trim();
  const gender = input.gender?.trim();
  const year = extractExplicitProductYear(input.description, maxYear);

  if (size) tags.push({ kind: "size", label: size });
  if (gender === "남성" || gender === "여성" || gender === "공용") {
    tags.push({ kind: "gender", label: gender });
  }
  if (year !== null) tags.push({ kind: "year", label: `${year}년` });

  return tags;
}
