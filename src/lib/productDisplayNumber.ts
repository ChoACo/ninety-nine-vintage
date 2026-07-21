export function getProductDisplayNumber(productId: string): number {
  let hash = 2166136261;
  for (const character of productId.replaceAll("-", "").toLowerCase()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return 100 + (hash >>> 0) % 999_900;
}

export function formatProductDisplayNumber(productId: string): string {
  return `상품 No. ${getProductDisplayNumber(productId).toLocaleString("ko-KR")}`;
}
