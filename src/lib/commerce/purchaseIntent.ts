"use client";

export type FixedPurchaseIntent = "cart" | "buy";

const PURCHASE_INTENT_KEY = "ninetynine-fixed-purchase-intent";
const PURCHASE_INTENT_MAX_AGE_MS = 10 * 60 * 1000;

interface StoredPurchaseIntent {
  productId: string;
  intent: FixedPurchaseIntent;
  createdAt: number;
}

export function rememberFixedPurchaseIntent(
  productId: string,
  intent: FixedPurchaseIntent,
  now = Date.now(),
): boolean {
  if (typeof window === "undefined" || !productId) return false;
  try {
    const value: StoredPurchaseIntent = {
      productId,
      intent,
      createdAt: now,
    };
    window.sessionStorage.setItem(PURCHASE_INTENT_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function consumeFixedPurchaseIntent(
  productId: string,
  intent: FixedPurchaseIntent,
  now = Date.now(),
): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.sessionStorage.getItem(PURCHASE_INTENT_KEY);
    window.sessionStorage.removeItem(PURCHASE_INTENT_KEY);
    if (!raw) return false;
    const stored = JSON.parse(raw) as Partial<StoredPurchaseIntent>;
    return (
      stored.productId === productId &&
      stored.intent === intent &&
      typeof stored.createdAt === "number" &&
      Number.isFinite(stored.createdAt) &&
      stored.createdAt <= now &&
      now - stored.createdAt <= PURCHASE_INTENT_MAX_AGE_MS
    );
  } catch {
    return false;
  }
}
