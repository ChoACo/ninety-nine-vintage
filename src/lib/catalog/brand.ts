const MAX_BRAND_LENGTH = 80;

export interface NormalizedBrand {
  brand: string;
  brandSlug: string;
}

export function toBrandSlug(value: string): string {
  const slug = value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, MAX_BRAND_LENGTH)
    .replace(/-+$/gu, "");
  return slug || "etc";
}

export function normalizeProductBrand(value: unknown): NormalizedBrand | null {
  if (typeof value !== "string") return null;
  const brand = value.normalize("NFKC").trim().replace(/\s+/gu, " ").slice(0, MAX_BRAND_LENGTH);
  if (!brand) return null;
  return { brand, brandSlug: toBrandSlug(brand) };
}

export function inferBrandFromTitle(value: unknown): NormalizedBrand {
  if (typeof value !== "string") return { brand: "기타", brandSlug: "etc" };
  const title = value.normalize("NFKC").replace(/^\s*\[[^\]]+\]\s*/u, "").trim();
  for (const token of title.split(/\s+/u)) {
    const normalized = normalizeProductBrand(token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""));
    if (normalized) return normalized;
  }
  return { brand: "기타", brandSlug: "etc" };
}
