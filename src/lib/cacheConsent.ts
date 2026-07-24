export const CACHE_CONSENT_KEY = "ninetynine-cache-consent-v1";
export const CACHE_CONSENT_EVENT = "ninetynine-cache-consent-change";
const CACHE_CONSENT_COOKIE = "ninetynine-cache-consent";
const CACHE_CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
export type CacheConsent = "accepted" | "declined" | "unknown";

function normalizeCacheConsent(value: string | null): CacheConsent {
  return value === "accepted" || value === "declined" ? value : "unknown";
}

function readCookieConsent(): CacheConsent {
  if (typeof document === "undefined") return "unknown";
  const value = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CACHE_CONSENT_COOKIE}=`))
    ?.slice(CACHE_CONSENT_COOKIE.length + 1);
  return normalizeCacheConsent(value ?? null);
}

function writeCookieConsent(value: Exclude<CacheConsent, "unknown">) {
  document.cookie = `${CACHE_CONSENT_COOKIE}=${value}; Path=/; Max-Age=${CACHE_CONSENT_MAX_AGE_SECONDS}; SameSite=Lax`;
}

function clearCookieConsent() {
  document.cookie = `${CACHE_CONSENT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function readCacheConsent(): CacheConsent {
  if (typeof window === "undefined") return "unknown";
  try {
    const stored = normalizeCacheConsent(window.localStorage.getItem(CACHE_CONSENT_KEY));
    if (stored !== "unknown") return stored;
  } catch { /* Use the first-party cookie fallback below. */ }
  return readCookieConsent();
}

export function writeCacheConsent(value: Exclude<CacheConsent, "unknown">) {
  try { window.localStorage.setItem(CACHE_CONSENT_KEY, value); } catch { /* private browsing */ }
  writeCookieConsent(value);
  window.dispatchEvent(new Event(CACHE_CONSENT_EVENT));
}

export function clearCacheConsent() {
  try { window.localStorage.removeItem(CACHE_CONSENT_KEY); } catch { /* private browsing */ }
  clearCookieConsent();
  window.dispatchEvent(new Event(CACHE_CONSENT_EVENT));
}

