export const CATALOG_FETCH_BATCH_SIZE = 100;
export const MAX_CATALOG_FETCH_BATCHES = 100;

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
