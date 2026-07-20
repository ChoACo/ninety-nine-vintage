const RETURN_TO_MAX_LENGTH = 200;
const UNSAFE_PATH_CHARACTERS = /[\\\u0000-\u001f\u007f]/;

/**
 * Accept only an application-local path. Browsers normalize backslashes in
 * special URLs, so a value such as `/\\example.com` must be rejected before it
 * reaches location.replace().
 */
export function safeSameOriginReturnTo(
  value: string | null | undefined,
  origin: string,
  fallback = "/account",
): string {
  if (
    !value ||
    value.length > RETURN_TO_MAX_LENGTH ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    UNSAFE_PATH_CHARACTERS.test(value) ||
    /%5c/i.test(value)
  ) {
    return fallback;
  }

  try {
    const base = new URL(origin);
    if (base.protocol !== "https:" && base.protocol !== "http:") {
      return fallback;
    }
    const resolved = new URL(value, base.origin);
    if (resolved.origin !== base.origin) return fallback;
    const normalized = `${resolved.pathname}${resolved.search}${resolved.hash}`;
    if (
      !normalized.startsWith("/") ||
      normalized.startsWith("//") ||
      UNSAFE_PATH_CHARACTERS.test(normalized) ||
      /%5c/i.test(normalized)
    ) {
      return fallback;
    }
    return normalized;
  } catch {
    return fallback;
  }
}
