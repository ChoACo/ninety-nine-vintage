/**
 * KCP and KPN accept only ASCII letters and digits in payment IDs. KCP also
 * caps IDs at 40 characters. Time plus UUID entropy prevents same-product
 * calls in the same millisecond from colliding; the DB UNIQUE constraint is
 * the final authority.
 */
export function createPortOnePaymentId(
  productId: string,
  now: number = Date.now(),
  randomUuid: string = crypto.randomUUID(),
): string {
  // KCP accepts at most 40 characters even though PortOne itself allows 64.
  const productPart = productId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10);
  const timestampPart = now.toString(36);
  const randomPart = randomUuid.replaceAll("-", "").slice(0, 16);
  return `P${productPart || "product"}${timestampPart}${randomPart}`;
}
