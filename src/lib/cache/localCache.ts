export const COMMERCE_LOCAL_CACHE_KEY = "ninetynine-commerce-cache";

const LEGACY_EMPTY_DATA_CACHE_KEYS = [
  "ninetynine-cart-cache",
  "ninetynine-storage-cache",
  "ninetynine-vault-cache",
] as const;

const APP_CACHE_DATABASE_PREFIXES = [
  "ninetynine-cart",
  "ninetynine-commerce",
  "ninetynine-storage",
  "ninetynine-vault",
] as const;

export interface CommerceLocalCache {
  cartIds: string[];
  likedIds: string[];
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      ),
    ),
  ];
}

export function readCommerceLocalCache(): CommerceLocalCache {
  if (typeof window === "undefined") return { cartIds: [], likedIds: [] };
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(COMMERCE_LOCAL_CACHE_KEY) ?? "{}",
    ) as { cartIds?: unknown; likedIds?: unknown };
    return {
      cartIds: normalizeIds(parsed.cartIds),
      likedIds: normalizeIds(parsed.likedIds),
    };
  } catch {
    return { cartIds: [], likedIds: [] };
  }
}

export function writeCommerceLocalCache(value: CommerceLocalCache): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      COMMERCE_LOCAL_CACHE_KEY,
      JSON.stringify({
        cartIds: normalizeIds(value.cartIds),
        likedIds: normalizeIds(value.likedIds),
      }),
    );
  } catch {
    // Storage can be unavailable in private browsing or restricted webviews.
  }
}

export function clearCommerceLocalCache(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(COMMERCE_LOCAL_CACHE_KEY);
  } catch {
    // The in-memory server snapshot remains authoritative.
  }
}

export function clearLegacyEmptyDataLocalCaches(): void {
  if (typeof window === "undefined") return;
  try {
    for (const key of LEGACY_EMPTY_DATA_CACHE_KEYS) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Cache cleanup must never prevent an empty state from rendering.
  }
}

export async function clearLegacyEmptyDataIndexedDbCaches(): Promise<void> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return;
  try {
    const databases = await window.indexedDB.databases?.();
    if (!databases) return;
    for (const database of databases) {
      const name = database.name;
      if (
        name &&
        APP_CACHE_DATABASE_PREFIXES.some((prefix) => name.startsWith(prefix))
      ) {
        window.indexedDB.deleteDatabase(name);
      }
    }
  } catch {
    // Older Safari and privacy modes may reject enumeration or deletion.
  }
}

export function clearEmptyProductDataCaches(): void {
  clearCommerceLocalCache();
  clearLegacyEmptyDataLocalCaches();
  void clearLegacyEmptyDataIndexedDbCaches();
}
