export type ResolvedUiMode = "mobile" | "desktop";

const CUSTOMER_ROOT_SEGMENTS = new Set([
  "account",
  "auction",
  "auth",
  "bidding",
  "cart",
  "chat",
  "checkout",
  "feed",
  "home",
  "payment",
  "privacy",
  "refund",
  "shop",
  "sold",
  "stores",
  "terms",
]);

const BOT_USER_AGENT = /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|kakaotalk-scrap/i;
const MOBILE_USER_AGENT = /android|iphone|ipad|ipod|mobile|tablet|silk|kindle|playbook/i;

export function isCustomerPagePath(pathname: string): boolean {
  if (pathname === "/") return true;
  const normalized = isMobilePath(pathname) ? toDesktopPath(pathname) : pathname;
  const segment = normalized.split("/").filter(Boolean)[0];
  return typeof segment === "string" && CUSTOMER_ROOT_SEGMENTS.has(segment);
}

export function isMobilePath(pathname: string): boolean {
  return pathname === "/m" || pathname === "/m/" || pathname.startsWith("/m/");
}

export function toMobilePath(pathname: string): string {
  if (isMobilePath(pathname)) return pathname === "/m/" ? "/m/home" : pathname;
  if (pathname === "/") return "/m/home";
  return `/m${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

export function toDesktopPath(pathname: string): string {
  if (pathname === "/m" || pathname === "/m/") return "/home";
  if (!pathname.startsWith("/m/")) return pathname;
  const desktopPath = pathname.slice(2);
  if (desktopPath === "/checkout") return "/cart";
  if (/^\/account\/(?:orders|bids|storage|shipping|addresses|saved|refunds|settings)(?:\/|$)/.test(desktopPath)) {
    return "/account";
  }
  return desktopPath || "/home";
}

export function resolveAutomaticUiMode(headers: Pick<Headers, "get">): ResolvedUiMode {
  const userAgent = headers.get("user-agent") ?? "";
  if (BOT_USER_AGENT.test(userAgent)) return "desktop";

  if (headers.get("sec-ch-ua-mobile") === "?1") return "mobile";
  if (MOBILE_USER_AGENT.test(userAgent)) return "mobile";
  return "desktop";
}
