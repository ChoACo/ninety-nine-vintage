import {
  clearHttpOnlyCookie,
  createAuthCallbackUrl,
  createRedirectResponse,
  getKakaoOidcConfiguration,
  KAKAO_ACCESS_TOKEN_COOKIE,
  KAKAO_ID_TOKEN_COOKIE,
  KAKAO_NONCE_COOKIE,
  KAKAO_STATE_COOKIE,
  KAKAO_TOKEN_ENDPOINT,
  readCookie,
  serializeHttpOnlyCookie,
  timingSafeStringEqual,
} from "@/lib/kakao/oidc";

interface KakaoTokenPayload {
  id_token?: unknown;
  access_token?: unknown;
}

function clearedOauthCookies(requestUrl: string): string[] {
  return [
    clearHttpOnlyCookie(requestUrl, KAKAO_STATE_COOKIE),
    clearHttpOnlyCookie(requestUrl, KAKAO_NONCE_COOKIE),
    clearHttpOnlyCookie(requestUrl, KAKAO_ID_TOKEN_COOKIE),
    clearHttpOnlyCookie(requestUrl, KAKAO_ACCESS_TOKEN_COOKIE),
  ];
}

function oauthFailure(requestUrl: string, code: string): Response {
  return createRedirectResponse(
    createAuthCallbackUrl(requestUrl, code),
    clearedOauthCookies(requestUrl),
  );
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const authorizationCode = requestUrl.searchParams.get("code");
  const returnedState = requestUrl.searchParams.get("state");
  const providerError = requestUrl.searchParams.get("error");
  const storedState = readCookie(request, KAKAO_STATE_COOKIE);
  const nonce = readCookie(request, KAKAO_NONCE_COOKIE);

  if (!timingSafeStringEqual(returnedState, storedState)) {
    return oauthFailure(request.url, "kakao_state");
  }
  if (providerError) return oauthFailure(request.url, "kakao_cancelled");
  if (!authorizationCode || !nonce) {
    return oauthFailure(request.url, "kakao_state");
  }

  try {
    const configuration = getKakaoOidcConfiguration(request.url);
    const tokenResponse = await fetch(KAKAO_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: configuration.clientId,
        client_secret: configuration.clientSecret,
        redirect_uri: configuration.redirectUri,
        code: authorizationCode,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });

    const payload = (await tokenResponse.json()) as KakaoTokenPayload;
    if (
      !tokenResponse.ok ||
      typeof payload.id_token !== "string" ||
      typeof payload.access_token !== "string"
    ) {
      return oauthFailure(request.url, "kakao_token");
    }

    const callbackUrl = createAuthCallbackUrl(request.url);
    callbackUrl.searchParams.set("kakao_oidc", "1");

    return createRedirectResponse(callbackUrl, [
      clearHttpOnlyCookie(request.url, KAKAO_STATE_COOKIE),
      serializeHttpOnlyCookie(
        request.url,
        KAKAO_NONCE_COOKIE,
        nonce,
        2 * 60,
      ),
      serializeHttpOnlyCookie(
        request.url,
        KAKAO_ID_TOKEN_COOKIE,
        payload.id_token,
        2 * 60,
      ),
      serializeHttpOnlyCookie(
        request.url,
        KAKAO_ACCESS_TOKEN_COOKIE,
        payload.access_token,
        2 * 60,
      ),
    ]);
  } catch {
    return oauthFailure(request.url, "kakao_token");
  }
}

