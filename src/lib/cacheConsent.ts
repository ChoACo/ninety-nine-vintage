export const CACHE_CONSENT_KEY = "ninetynine-cache-consent-v1";
export const CACHE_CONSENT_EVENT = "ninetynine-cache-consent-change";
export type CacheConsent = "accepted" | "declined" | "unknown";

export function readCacheConsent(): CacheConsent {
  if (typeof window === "undefined") return "unknown";
  try {
    const value = window.localStorage.getItem(CACHE_CONSENT_KEY);
    return value === "accepted" || value === "declined" ? value : "unknown";
  } catch { return "unknown"; }
}

export function writeCacheConsent(value: Exclude<CacheConsent, "unknown">) {
  try { window.localStorage.setItem(CACHE_CONSENT_KEY, value); } catch { /* private browsing */ }
  window.dispatchEvent(new Event(CACHE_CONSENT_EVENT));
}

export function clearCacheConsent() {
  try { window.localStorage.removeItem(CACHE_CONSENT_KEY); } catch { /* private browsing */ }
  window.dispatchEvent(new Event(CACHE_CONSENT_EVENT));
}

