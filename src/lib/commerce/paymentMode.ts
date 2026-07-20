export type CommercePaymentMode = "manual_transfer" | "portone";

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
