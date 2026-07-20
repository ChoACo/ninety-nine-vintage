const DEFAULT_PRODUCT_LIMIT = 24;
const MAX_PRODUCT_LIMIT = 100;
const MAX_SEARCH_LENGTH = 80;

export function normalizeProductLimit(
  value: unknown,
  fallback = DEFAULT_PRODUCT_LIMIT,
): number {
  const numeric = typeof value === "number" ? value : Number(value);
  const safeFallback = Number.isFinite(fallback)
    ? Math.min(Math.max(Math.floor(fallback), 1), MAX_PRODUCT_LIMIT)
    : DEFAULT_PRODUCT_LIMIT;
  if (!Number.isFinite(numeric)) return safeFallback;
  return Math.min(Math.max(Math.floor(numeric), 1), MAX_PRODUCT_LIMIT);
}

export function normalizeCatalogSearch(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEARCH_LENGTH)
    .trim();
}
