const KAKAO_AUTHORIZE_ENDPOINT = "https://kauth.kakao.com/oauth/authorize";

export const KAKAO_TOKEN_ENDPOINT = "https://kauth.kakao.com/oauth/token";
export const KAKAO_USERINFO_ENDPOINT =
  "https://kapi.kakao.com/v1/oidc/userinfo";
export const KAKAO_STATE_COOKIE = "dami_kakao_oauth_state";
export const KAKAO_NONCE_COOKIE = "dami_kakao_oauth_nonce";
export const KAKAO_ID_TOKEN_COOKIE = "dami_kakao_id_token";
export const KAKAO_ACCESS_TOKEN_COOKIE = "dami_kakao_access_token";
export const KAKAO_RETURN_TO_COOKIE = "dami_kakao_return_to";

export interface KakaoOidcConfiguration {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class KakaoOidcConfigurationError extends Error {
  constructor() {
    super("Kakao OIDC server configuration is incomplete.");
    this.name = "KakaoOidcConfigurationError";
  }
}

export function getKakaoOidcConfiguration(
  requestUrl: string,
): KakaoOidcConfiguration {
  const clientId = process.env.KAKAO_REST_API_KEY?.trim();
  const clientSecret = process.env.KAKAO_CLIENT_SECRET?.trim();
  const fallbackRedirectUri = new URL(
    "/api/auth/kakao/oidc",
    requestUrl,
  ).toString();
  const redirectUri =
    process.env.KAKAO_OIDC_REDIRECT_URI?.trim() || fallbackRedirectUri;

  if (!clientId || !clientSecret) throw new KakaoOidcConfigurationError();

  let parsedRedirectUri: URL;
  try {
    parsedRedirectUri = new URL(redirectUri);
  } catch {
    throw new KakaoOidcConfigurationError();
  }

  const isLocalhost =
    parsedRedirectUri.hostname === "localhost" ||
    parsedRedirectUri.hostname === "127.0.0.1";
  const hasSafeProtocol =
    parsedRedirectUri.protocol === "https:" ||
    (isLocalhost && parsedRedirectUri.protocol === "http:");

  if (
    !hasSafeProtocol ||
    parsedRedirectUri.pathname !== "/api/auth/kakao/oidc"
  ) {
    throw new KakaoOidcConfigurationError();
  }

  return { clientId, clientSecret, redirectUri: parsedRedirectUri.toString() };
}

export function createRandomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function hashTokenSha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function buildKakaoAuthorizeUrl(
  configuration: KakaoOidcConfiguration,
  state: string,
  hashedNonce: string,
): URL {
  const authorizeUrl = new URL(KAKAO_AUTHORIZE_ENDPOINT);
  authorizeUrl.searchParams.set("client_id", configuration.clientId);
  authorizeUrl.searchParams.set("redirect_uri", configuration.redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  // Deliberately omit `scope`. Kakao then requests exactly the consent items
  // configured in Developers. This prevents KOE205 before review approval and
  // automatically picks up newly approved required items after they are saved.
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("nonce", hashedNonce);
  return authorizeUrl;
}

export function getKakaoCookiePath(name: string): string {
  if (name === KAKAO_ID_TOKEN_COOKIE) return "/api/auth/kakao/session";
  if (name === KAKAO_ACCESS_TOKEN_COOKIE) return "/api/auth/kakao/profile";
  return "/api/auth/kakao";
}

export function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const item of cookieHeader.split(";")) {
    const separatorIndex = item.indexOf("=");
    if (separatorIndex < 0) continue;
    const key = item.slice(0, separatorIndex).trim();
    if (key !== name) continue;

    try {
      return decodeURIComponent(item.slice(separatorIndex + 1).trim());
    } catch {
      return null;
    }
  }

  return null;
}

export function serializeHttpOnlyCookie(
  requestUrl: string,
  name: string,
  value: string,
  maxAge: number,
): string {
  const isSecure = new URL(requestUrl).protocol === "https:";
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${getKakaoCookiePath(name)}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    isSecure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearHttpOnlyCookie(
  requestUrl: string,
  name: string,
): string {
  return serializeHttpOnlyCookie(requestUrl, name, "", 0);
}

export function timingSafeStringEqual(
  first: string | null,
  second: string | null,
): boolean {
  if (!first || !second || first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }
  return difference === 0;
}

export function createRedirectResponse(
  location: URL,
  cookies: string[] = [],
  status = 302,
): Response {
  const headers = new Headers({
    Location: location.toString(),
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status, headers });
}

export function createAuthCallbackUrl(
  requestUrl: string,
  errorCode?: string,
): URL {
  const callbackUrl = new URL("/auth/callback", requestUrl);
  if (errorCode) callbackUrl.searchParams.set("error", errorCode);
  return callbackUrl;
}

export function hasTrustedRequestOrigin(request: Request): boolean {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  return origin === requestUrl.origin;
}
