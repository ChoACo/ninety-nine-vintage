export interface PublicSoldAuctionCursor {
  soldAt: string;
  productId: string;
}

export interface CompositeCursorPage<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: PublicSoldAuctionCursor | null;
}

/**
 * RPC가 pageSize + 1건을 반환하면 노출할 페이지와 다음 복합 커서를
 * 결정합니다. 커서는 마지막으로 노출한 행을 가리켜 경계 행을 건너뛰지
 * 않습니다.
 */
export function createCompositeCursorPage<
  T extends { productId: string; soldAt: string },
>(rows: readonly T[], pageSize: number): CompositeCursorPage<T> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new RangeError("페이지 크기는 1 이상의 정수여야 합니다.");
  }

  const items = rows.slice(0, pageSize);
  const hasMore = rows.length > pageSize;
  const lastItem = items.at(-1);

  return {
    items,
    hasMore,
    nextCursor:
      hasMore && lastItem
        ? { soldAt: lastItem.soldAt, productId: lastItem.productId }
        : null,
  };
}
