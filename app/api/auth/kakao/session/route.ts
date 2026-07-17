import {
  clearHttpOnlyCookie,
  hasTrustedRequestOrigin,
  KAKAO_ID_TOKEN_COOKIE,
  KAKAO_NONCE_COOKIE,
  KAKAO_STATE_COOKIE,
  readCookie,
} from "@/src/lib/kakao/oidc";

function sessionResponse(
  requestUrl: string,
  body: Record<string, unknown>,
  status: number,
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
    ]) {
      headers.append("Set-Cookie", clearHttpOnlyCookie(requestUrl, cookieName));
    }
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export async function POST(request: Request) {
  if (!hasTrustedRequestOrigin(request)) {
    return sessionResponse(request.url, { error: "forbidden" }, 403, false);
  }

  const idToken = readCookie(request, KAKAO_ID_TOKEN_COOKIE);
  const nonce = readCookie(request, KAKAO_NONCE_COOKIE);
  if (!idToken || !nonce) {
    return sessionResponse(request.url, { error: "expired" }, 401);
  }

  return sessionResponse(request.url, { idToken, nonce }, 200);
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
