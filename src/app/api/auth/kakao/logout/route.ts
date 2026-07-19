import {
  clearHttpOnlyCookie,
  hasTrustedRequestOrigin,
  KAKAO_ACCESS_TOKEN_COOKIE,
  KAKAO_ID_TOKEN_COOKIE,
  KAKAO_NONCE_COOKIE,
  KAKAO_RETURN_TO_COOKIE,
  KAKAO_STATE_COOKIE,
} from "@/lib/kakao/oidc";

export async function POST(request: Request) {
  if (!hasTrustedRequestOrigin(request)) return Response.json({ error: "forbidden" }, { status: 403 });
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const name of [KAKAO_ACCESS_TOKEN_COOKIE, KAKAO_ID_TOKEN_COOKIE, KAKAO_NONCE_COOKIE, KAKAO_RETURN_TO_COOKIE, KAKAO_STATE_COOKIE]) headers.append("Set-Cookie", clearHttpOnlyCookie(request.url, name));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
