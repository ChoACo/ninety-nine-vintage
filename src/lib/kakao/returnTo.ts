const RETURN_TO_MAX_LENGTH = 200;
const UNSAFE_PATH_CHARACTERS = /[\\\u0000-\u001f\u007f]/;
const AUTHENTICATION_PATHS = new Set([
  "/account/login",
  "/auth/callback",
  "/m/account/login",
  "/m/auth/callback",
]);
// Only the shared browsing surfaces may be restored after login. Every other
// page routes the member to home so filters, the viewed product, pagination
// and the scroll position are never mixed across unrelated screens.
const POST_LOGIN_RETURN_PATHS = new Set([
  "/home",
  "/feed",
  "/shop",
  "/m/home",
  "/m/feed",
  "/m/shop",
]);

function isAuthenticationPath(pathname: string): boolean {
  const normalized =
    pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return (
    AUTHENTICATION_PATHS.has(normalized) ||
    normalized.startsWith("/api/auth/kakao")
  );
}

function applicationPathname(value: string): string | null {
  try {
    return new URL(value, "https://return-to.invalid").pathname;
  } catch {
    return null;
  }
}

export function resolveKakaoPostLoginReturnTo(
  requestedReturnTo: string,
): string {
  const pathname = applicationPathname(requestedReturnTo);
  const homePath =
    pathname === "/m" || pathname?.startsWith("/m/")
      ? "/m/home"
      : "/home";

  if (
    !pathname ||
    isAuthenticationPath(pathname) ||
    !POST_LOGIN_RETURN_PATHS.has(pathname)
  ) {
    return homePath;
  }

  return requestedReturnTo;
}

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
      /%5c/i.test(normalized) ||
      isAuthenticationPath(resolved.pathname)
    ) {
      return fallback;
    }
    return normalized;
  } catch {
    return fallback;
  }
}
