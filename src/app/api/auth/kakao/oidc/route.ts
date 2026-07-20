import {
  clearHttpOnlyCookie,
  createAuthCallbackUrl,
  createRedirectResponse,
  getKakaoOidcConfiguration,
  getKakaoFlowCookieName,
  KAKAO_ACCESS_TOKEN_COOKIE,
  KAKAO_ID_TOKEN_COOKIE,
  KAKAO_NONCE_COOKIE,
  KAKAO_RETURN_TO_COOKIE,
  KAKAO_STATE_COOKIE,
  KAKAO_TOKEN_ENDPOINT,
  normalizeKakaoFlowId,
  readCookie,
  serializeHttpOnlyCookie,
  timingSafeStringEqual,
} from "@/src/lib/kakao/oidc";

interface KakaoTokenPayload {
  id_token?: unknown;
  access_token?: unknown;
}

function clearedOauthCookies(
  requestUrl: string,
  flowId: string | null,
): string[] {
  return [
    clearHttpOnlyCookie(
      requestUrl,
      getKakaoFlowCookieName(KAKAO_STATE_COOKIE, flowId),
    ),
    clearHttpOnlyCookie(
      requestUrl,
      getKakaoFlowCookieName(KAKAO_NONCE_COOKIE, flowId),
    ),
    clearHttpOnlyCookie(
      requestUrl,
      getKakaoFlowCookieName(KAKAO_ID_TOKEN_COOKIE, flowId),
    ),
    clearHttpOnlyCookie(
      requestUrl,
      getKakaoFlowCookieName(KAKAO_ACCESS_TOKEN_COOKIE, flowId),
    ),
    clearHttpOnlyCookie(
      requestUrl,
      getKakaoFlowCookieName(KAKAO_RETURN_TO_COOKIE, flowId),
    ),
  ];
}

function oauthFailure(
  requestUrl: string,
  code: string,
  flowId: string | null = null,
): Response {
  return createRedirectResponse(
    createAuthCallbackUrl(requestUrl, code),
    flowId ? clearedOauthCookies(requestUrl, flowId) : [],
  );
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const authorizationCode = requestUrl.searchParams.get("code");
  const returnedState = requestUrl.searchParams.get("state");
  const flowId = normalizeKakaoFlowId(returnedState);
  const providerError = requestUrl.searchParams.get("error");
  if (!flowId) return oauthFailure(request.url, "kakao_state");
  const stateCookieName = getKakaoFlowCookieName(KAKAO_STATE_COOKIE, flowId);
  const nonceCookieName = getKakaoFlowCookieName(KAKAO_NONCE_COOKIE, flowId);
  const idTokenCookieName = getKakaoFlowCookieName(
    KAKAO_ID_TOKEN_COOKIE,
    flowId,
  );
  const accessTokenCookieName = getKakaoFlowCookieName(
    KAKAO_ACCESS_TOKEN_COOKIE,
    flowId,
  );
  const storedState = readCookie(request, stateCookieName);
  const nonce = readCookie(request, nonceCookieName);

  if (!timingSafeStringEqual(returnedState, storedState)) {
    return oauthFailure(request.url, "kakao_state", flowId);
  }
  if (providerError) {
    return oauthFailure(request.url, "kakao_cancelled", flowId);
  }
  if (!authorizationCode || !nonce) {
    return oauthFailure(request.url, "kakao_state", flowId);
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
      return oauthFailure(request.url, "kakao_token", flowId);
    }

    const callbackUrl = createAuthCallbackUrl(request.url);
    callbackUrl.searchParams.set("kakao_oidc", "1");
    callbackUrl.searchParams.set("flow", flowId);

    return createRedirectResponse(callbackUrl, [
      clearHttpOnlyCookie(request.url, stateCookieName),
      serializeHttpOnlyCookie(
        request.url,
        nonceCookieName,
        nonce,
        2 * 60,
      ),
      serializeHttpOnlyCookie(
        request.url,
        idTokenCookieName,
        payload.id_token,
        2 * 60,
      ),
      serializeHttpOnlyCookie(
        request.url,
        accessTokenCookieName,
        payload.access_token,
        2 * 60,
      ),
    ]);
  } catch {
    return oauthFailure(request.url, "kakao_token", flowId);
  }
}
