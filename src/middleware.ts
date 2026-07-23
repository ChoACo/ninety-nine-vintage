import { NextResponse, type NextRequest } from "next/server";
import {
  MOBILE_AUTO_REDIRECT_ENABLED,
  MOBILE_SITE_ENABLED,
} from "@/lib/featureFlags";
import {
  isCustomerPagePath,
  isMobilePath,
  resolveAutomaticUiMode,
  toDesktopPath,
  toMobilePath,
} from "@/lib/uiMode";

// Keep this entrypoint on the Edge middleware convention: the current
// OpenNext Cloudflare adapter rejects Next.js's Node.js-only proxy runtime.

const SKIPPED_PATHS = [
  "/api/security/session",
  "/api/webhook/portone",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
];
const LEGACY_UI_MODE_COOKIE = "ninety-nine-ui-mode";

function getTrustedClientIp(request: NextRequest): string | null {
  const vercelForwarded = request.headers.get("x-vercel-forwarded-for");
  const forwarded =
    vercelForwarded ??
    (process.env.VERCEL === "1"
      ? null
      : request.headers.get("x-forwarded-for") ??
        request.headers.get("x-real-ip"));
  const first = forwarded?.split(",", 1)[0]?.trim();
  return first || null;
}

function shouldSkip(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/assets/") ||
    /\.(?:avif|css|gif|ico|jpe?g|js|map|png|svg|webp|woff2?)$/i.test(pathname) ||
    SKIPPED_PATHS.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    )
  );
}

async function isBlockedIp(ipAddress: string): Promise<boolean> {
  const supabaseUrl =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) return false;

  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/is_security_ip_blocked`,
      {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_ip: ipAddress }),
        cache: "no-store",
        signal: AbortSignal.timeout(2_000),
      },
    );
    if (!response.ok) return false;
    return (await response.json()) === true;
  } catch {
    // Availability failures must not lock every customer out. Authenticated
    // clients retry the same check through /api/security/session.
    return false;
  }
}

function blockedResponse(request: NextRequest): Response {
  const headers = {
    "Cache-Control": "private, no-store, max-age=0",
    "X-Robots-Tag": "noindex, nofollow",
  };
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return Response.json(
      { error: "ip_blocked", message: "현재 네트워크의 접속이 차단되었습니다." },
      { status: 403, headers },
    );
  }

  return new Response(
    `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="light dark"><title>접속 제한</title><style>:root{color-scheme:light dark;--page:#f8f2eb;--ink:#463a33;--line:#ddcbbb;--surface:#fffaf4}@media(prefers-color-scheme:dark){:root{--page:#15181c;--ink:#f1ece2;--line:#404750;--surface:#20252b}}body{margin:0;background:var(--page);color:var(--ink);font-family:system-ui,sans-serif}main{min-height:100vh;display:grid;place-items:center;padding:24px}section{max-width:520px;padding:32px;border:1px solid var(--line);border-radius:24px;background:var(--surface);text-align:center}p{line-height:1.8;font-weight:700}</style><body><main><section><h1>보안 정책에 따라 접속이 제한되었습니다</h1><p>비정상 접속이나 오남용 방지를 위해 현재 네트워크가 차단되었습니다. 잘못 차단되었다면 고객센터에 차단 시각과 함께 해제를 요청해 주세요.</p></section></main></body></html>`,
    { status: 403, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } },
  );
}

function mobileSiteRedirect(request: NextRequest): NextResponse | null {
  if (
    !MOBILE_SITE_ENABLED ||
    !MOBILE_AUTO_REDIRECT_ENABLED ||
    !isCustomerPagePath(request.nextUrl.pathname)
  ) {
    return null;
  }

  const resolvedMode = resolveAutomaticUiMode(request.headers);
  const mobilePath = isMobilePath(request.nextUrl.pathname);
  if (
    (resolvedMode === "mobile" && mobilePath) ||
    (resolvedMode === "desktop" && !mobilePath)
  ) {
    return null;
  }

  const destination = request.nextUrl.clone();
  destination.pathname =
    resolvedMode === "mobile"
      ? toMobilePath(destination.pathname)
      : toDesktopPath(destination.pathname);
  const response = NextResponse.redirect(destination, 307);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Sec-CH-UA-Mobile, User-Agent");
  return response;
}

function expireLegacyUiModeCookie(request: NextRequest, response: NextResponse): NextResponse {
  if (
    isCustomerPagePath(request.nextUrl.pathname) &&
    request.cookies.has(LEGACY_UI_MODE_COOKIE)
  ) {
    response.cookies.delete(LEGACY_UI_MODE_COOKIE);
  }
  return response;
}

export async function middleware(request: NextRequest) {
  if (shouldSkip(request.nextUrl.pathname)) return NextResponse.next();

  const ipAddress = getTrustedClientIp(request);
  if (ipAddress && (await isBlockedIp(ipAddress))) {
    return blockedResponse(request);
  }

  return expireLegacyUiModeCookie(
    request,
    mobileSiteRedirect(request) ?? NextResponse.next(),
  );
}

export const config = {
  matcher: ["/:path*"],
};
