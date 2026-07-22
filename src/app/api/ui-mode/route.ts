import { NextResponse } from "next/server";
import { safeSameOriginReturnTo } from "@/lib/kakao/returnTo";
import {
  isUiMode,
  resolveAutomaticUiMode,
  toDesktopPath,
  toMobilePath,
  UI_MODE_COOKIE,
} from "@/lib/uiMode";

const UI_MODE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

interface UiModeBody {
  mode?: unknown;
  returnTo?: unknown;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as UiModeBody | null;
  if (!isUiMode(body?.mode)) {
    return NextResponse.json({ error: "지원하지 않는 화면 모드입니다." }, { status: 400 });
  }

  const requestUrl = new URL(request.url);
  const returnTo = safeSameOriginReturnTo(
    typeof body?.returnTo === "string" ? body.returnTo : null,
    requestUrl.origin,
    "/home",
  );
  const returnUrl = new URL(returnTo, requestUrl.origin);
  const resolvedMode =
    body.mode === "auto" ? resolveAutomaticUiMode(request.headers) : body.mode;
  const pathname =
    resolvedMode === "mobile"
      ? toMobilePath(returnUrl.pathname)
      : toDesktopPath(returnUrl.pathname);
  const redirectTo = `${pathname}${returnUrl.search}${returnUrl.hash}`;

  const response = NextResponse.json({ mode: body.mode, resolvedMode, redirectTo });
  if (body.mode === "auto") {
    response.cookies.delete(UI_MODE_COOKIE);
  } else {
    response.cookies.set(UI_MODE_COOKIE, body.mode, {
      httpOnly: true,
      maxAge: UI_MODE_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: requestUrl.protocol === "https:",
    });
  }
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}
