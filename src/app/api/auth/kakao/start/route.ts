import {
  buildKakaoAuthorizeUrl,
  createRandomToken,
  createRedirectResponse,
  getKakaoOidcConfiguration,
  getKakaoFlowCookieName,
  hashTokenSha256,
  KAKAO_NONCE_COOKIE,
  KAKAO_RETURN_TO_COOKIE,
  KAKAO_STATE_COOKIE,
  serializeHttpOnlyCookie,
  createAuthCallbackUrl,
} from "@/src/lib/kakao/oidc";
import { safeSameOriginReturnTo } from "@/src/lib/kakao/returnTo";

export async function GET(request: Request) {
  try {
    const configuration = getKakaoOidcConfiguration(request.url);
    const callbackOrigin = new URL(configuration.redirectUri).origin;
    const requestOrigin = new URL(request.url).origin;
    const returnTo = safeSameOriginReturnTo(
      new URL(request.url).searchParams.get("returnTo"),
      requestOrigin,
    );

    // Keep the transient cookies on the same origin that Kakao redirects to.
    if (callbackOrigin !== requestOrigin) {
      return createRedirectResponse(
        new URL(
          `/api/auth/kakao/start?returnTo=${encodeURIComponent(returnTo)}`,
          callbackOrigin,
        ),
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
        getKakaoFlowCookieName(KAKAO_RETURN_TO_COOKIE, state),
        returnTo,
        10 * 60,
      ),
      serializeHttpOnlyCookie(
        request.url,
        getKakaoFlowCookieName(KAKAO_STATE_COOKIE, state),
        state,
        10 * 60,
      ),
      serializeHttpOnlyCookie(
        request.url,
        getKakaoFlowCookieName(KAKAO_NONCE_COOKIE, state),
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
