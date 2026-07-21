export type CommercePaymentMode = "manual_transfer" | "portone";

/**
 * Product policy: bank transfer is the only live checkout path. PortOne types
 * and adapters remain in the repository for a future, deliberate restoration.
 */
export const ACTIVE_COMMERCE_PAYMENT_MODE = "manual_transfer" as const;
export const PORTONE_COMMERCE_ENABLED = false;

export function readCommercePaymentMode(
  value: unknown,
): CommercePaymentMode | null {
  return value === "manual_transfer" || value === "portone" ? value : null;
}

export function paymentModeMatches(
  expected: CommercePaymentMode,
  current: CommercePaymentMode,
): boolean {
  return expected === current;
}
