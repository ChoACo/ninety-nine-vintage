import {
  buildKakaoAuthorizeUrl,
  createRandomToken,
  createRedirectResponse,
  getKakaoOidcConfiguration,
  hashTokenSha256,
  KAKAO_NONCE_COOKIE,
  KAKAO_STATE_COOKIE,
  serializeHttpOnlyCookie,
  createAuthCallbackUrl,
} from "@/src/lib/kakao/oidc";

export async function GET(request: Request) {
  try {
    const configuration = getKakaoOidcConfiguration(request.url);
    const callbackOrigin = new URL(configuration.redirectUri).origin;
    const requestOrigin = new URL(request.url).origin;

    // Keep the transient cookies on the same origin that Kakao redirects to.
    if (callbackOrigin !== requestOrigin) {
      return createRedirectResponse(
        new URL("/api/auth/kakao/start", callbackOrigin),
        [],
        307,
      );
    }

    const state = createRandomToken();
    const rawNonce = createRandomToken();
    const hashedNonce = await hashTokenSha256(rawNonce);
    const authorizeUrl = buildKakaoAuthorizeUrl(
      configuration,
      state,
      hashedNonce,
    );

    return createRedirectResponse(authorizeUrl, [
      serializeHttpOnlyCookie(
        request.url,
        KAKAO_STATE_COOKIE,
        state,
        10 * 60,
      ),
      serializeHttpOnlyCookie(
        request.url,
        KAKAO_NONCE_COOKIE,
        rawNonce,
        10 * 60,
      ),
    ]);
  } catch {
    return createRedirectResponse(
      createAuthCallbackUrl(request.url, "kakao_configuration"),
    );
  }
}
