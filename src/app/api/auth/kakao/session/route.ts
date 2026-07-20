import {
  clearHttpOnlyCookie,
  getKakaoFlowCookieName,
  hasTrustedRequestOrigin,
  KAKAO_ID_TOKEN_COOKIE,
  KAKAO_NONCE_COOKIE,
  KAKAO_RETURN_TO_COOKIE,
  KAKAO_STATE_COOKIE,
  normalizeKakaoFlowId,
  readCookie,
} from "@/src/lib/kakao/oidc";

function sessionResponse(
  requestUrl: string,
  body: Record<string, unknown>,
  status: number,
  flowId: string | null,
  clearCookies = true,
): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  if (clearCookies) {
    for (const cookieName of [
      KAKAO_ID_TOKEN_COOKIE,
      KAKAO_NONCE_COOKIE,
      KAKAO_STATE_COOKIE,
      KAKAO_RETURN_TO_COOKIE,
    ]) {
      headers.append(
        "Set-Cookie",
        clearHttpOnlyCookie(
          requestUrl,
          getKakaoFlowCookieName(cookieName, flowId),
        ),
      );
    }
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export async function POST(request: Request) {
  if (!hasTrustedRequestOrigin(request)) {
    return sessionResponse(request.url, { error: "forbidden" }, 403, null, false);
  }

  const rawFlowId = new URL(request.url).searchParams.get("flow");
  const flowId = normalizeKakaoFlowId(rawFlowId);
  if (rawFlowId !== null && !flowId) {
    return sessionResponse(request.url, { error: "expired" }, 401, null, false);
  }
  const idTokenCookieName = getKakaoFlowCookieName(
    KAKAO_ID_TOKEN_COOKIE,
    flowId,
  );
  const nonceCookieName = getKakaoFlowCookieName(KAKAO_NONCE_COOKIE, flowId);
  const returnToCookieName = getKakaoFlowCookieName(
    KAKAO_RETURN_TO_COOKIE,
    flowId,
  );
  const idToken = readCookie(request, idTokenCookieName);
  const nonce = readCookie(request, nonceCookieName);
  if (!idToken || !nonce) {
    return sessionResponse(request.url, { error: "expired" }, 401, flowId);
  }

  return sessionResponse(
    request.url,
    {
      idToken,
      nonce,
      returnTo: readCookie(request, returnToCookieName) ?? "/account",
    },
    200,
    flowId,
  );
}

export async function GET() {
  return Response.json(
    { error: "method_not_allowed" },
    {
      status: 405,
      headers: {
        Allow: "POST",
        "Cache-Control": "no-store",
      },
    },
  );
}
