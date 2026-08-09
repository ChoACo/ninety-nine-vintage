export type CommercePaymentMode = "manual_transfer";

export const ACTIVE_COMMERCE_PAYMENT_MODE = "manual_transfer" as const;

export function readCommercePaymentMode(
  value: unknown,
): CommercePaymentMode | null {
  return value === "manual_transfer" ? value : null;
}

export function paymentModeMatches(
  expected: CommercePaymentMode,
  current: CommercePaymentMode,
): boolean {
  return expected === current;
}
