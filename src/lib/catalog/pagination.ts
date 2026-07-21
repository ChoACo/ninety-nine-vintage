export const CATALOG_FETCH_BATCH_SIZE = 100;
export const MAX_CATALOG_FETCH_BATCHES = 100;

export type CatalogProductSort = "latest" | "ending" | "price_asc" | "price_desc";

interface SortableCatalogProduct {
  closesAt: string;
  currentPrice: number;
  fixedPrice: number | null;
  id: string;
  publishAt: string;
  saleType: "auction" | "fixed";
}

function compareProductIds(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function validTimestamp(value: string, fallback: number) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function validPrice(product: SortableCatalogProduct, fallback: number) {
  const price = product.saleType === "fixed"
    ? product.fixedPrice
    : product.currentPrice;
  return typeof price === "number" && Number.isFinite(price) ? price : fallback;
}

export function sortCatalogProducts<T extends SortableCatalogProduct>(
  products: readonly T[],
  sort: CatalogProductSort,
): T[] {
  return [...products].sort((left, right) => {
    let primary = 0;
    if (sort === "ending") {
      primary = validTimestamp(left.closesAt, Number.POSITIVE_INFINITY)
        - validTimestamp(right.closesAt, Number.POSITIVE_INFINITY);
    } else if (sort === "price_asc") {
      primary = validPrice(left, Number.POSITIVE_INFINITY)
        - validPrice(right, Number.POSITIVE_INFINITY);
    } else if (sort === "price_desc") {
      primary = validPrice(right, Number.NEGATIVE_INFINITY)
        - validPrice(left, Number.NEGATIVE_INFINITY);
    } else {
      primary = validTimestamp(right.publishAt, Number.NEGATIVE_INFINITY)
        - validTimestamp(left.publishAt, Number.NEGATIVE_INFINITY);
    }
    return primary || compareProductIds(left.id, right.id);
  });
}

export function mergeCatalogProductBatch<T extends { id: string }>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  const merged = new Map<string, T>();
  for (const product of current) {
    if (product.id) merged.set(product.id, product);
  }
  for (const product of incoming) {
    if (product.id) merged.set(product.id, product);
  }
  return [...merged.values()];
}

export function getNextCatalogOffset(
  currentOffset: number,
  receivedCount: number,
  batchSize = CATALOG_FETCH_BATCH_SIZE,
): number | null {
  if (
    !Number.isSafeInteger(currentOffset)
    || currentOffset < 0
    || !Number.isSafeInteger(receivedCount)
    || receivedCount < 0
    || !Number.isSafeInteger(batchSize)
    || batchSize < 1
    || receivedCount > batchSize
  ) {
    throw new RangeError("상품 페이지 범위가 올바르지 않습니다.");
  }
  if (receivedCount < batchSize) return null;
  const nextOffset = currentOffset + receivedCount;
  if (!Number.isSafeInteger(nextOffset) || nextOffset <= currentOffset) {
    throw new RangeError("다음 상품 페이지를 계산하지 못했습니다.");
  }
  return nextOffset;
}
