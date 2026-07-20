import { NextRequest, NextResponse } from "next/server";
import { getEntryGateCookieName, verifyEntryPass } from "@/lib/entryGateCookie";

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|robots.txt|sitemap.xml|sw.js|auth/callback).*)"],
};

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/") return NextResponse.next();
  const pass = request.cookies.get(getEntryGateCookieName())?.value;
  if (await verifyEntryPass(pass)) return NextResponse.next();

  const target = `${pathname}${search}`;
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/";
  redirectUrl.search = "";
  redirectUrl.searchParams.set("next", target);
  const requestId = crypto.randomUUID();
  console.info(JSON.stringify({ event: "entry_redirect", requestId, pathname, version: process.env.NEXT_PUBLIC_DEPLOY_VERSION?.trim() || "v1" }));
  return NextResponse.redirect(redirectUrl);
}

