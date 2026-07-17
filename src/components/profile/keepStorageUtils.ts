import type { WonAuction } from "@/src/types/auction";
import { getKeepExpiration } from "@/src/utils/shipping";

export function getKeepItemExpiration(item: WonAuction): string {
  if (item.keepExpiresAt) return item.keepExpiresAt;
  return getKeepExpiration(item.paidAt ?? item.closedAt, item.isBulky);
}

/** 보관 기한이 가장 촉박한 상품이 항상 먼저 보이도록 정렬합니다. */
export function sortKeepItemsByExpiration(
  items: readonly WonAuction[],
): WonAuction[] {
  return [...items].sort((left, right) => {
    const expirationDifference =
      new Date(getKeepItemExpiration(left)).getTime() -
      new Date(getKeepItemExpiration(right)).getTime();

    if (expirationDifference !== 0) return expirationDifference;
    return left.id.localeCompare(right.id);
  });
}
