const RETURN_SCROLL_STORAGE_KEY = "ninety-nine:login-return-scroll";

const RETURNABLE_SURFACES = new Set([
  "/home",
  "/feed",
  "/shop",
  "/m/home",
  "/m/feed",
  "/m/shop",
]);

const LOGIN_NAVIGATION_PATHS = new Set([
  "/account/login",
  "/m/account/login",
  "/auth/callback",
  "/m/auth/callback",
]);

export function isReturnableLoginSurface(pathname: string): boolean {
  return RETURNABLE_SURFACES.has(pathname);
}

function isLoginNavigationPath(pathname: string): boolean {
  if (LOGIN_NAVIGATION_PATHS.has(pathname)) return true;
  return (
    pathname.startsWith("/api/auth/kakao/") ||
    pathname.startsWith("/m/api/auth/kakao/")
  );
}

export function isLoginNavigationUrl(href: string): boolean {
  try {
    return isLoginNavigationPath(new URL(href, "https://return-scroll.invalid").pathname);
  } catch {
    return false;
  }
}

function memoryKey(path: string): string {
  return `${path}${window.location.search}`;
}

export function saveReturnScroll(path: string): void {
  try {
    sessionStorage.setItem(
      RETURN_SCROLL_STORAGE_KEY,
      JSON.stringify({ path: memoryKey(path), scrollY: window.scrollY }),
    );
  } catch {
    // sessionStorage can be unavailable in restricted webviews.
  }
}

export function readReturnScroll(path: string): number | null {
  try {
    const raw = sessionStorage.getItem(RETURN_SCROLL_STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { path: string; scrollY: number };
    sessionStorage.removeItem(RETURN_SCROLL_STORAGE_KEY);
    if (stored.path !== memoryKey(path)) return null;
    return typeof stored.scrollY === "number" ? stored.scrollY : null;
  } catch {
    return null;
  }
}
