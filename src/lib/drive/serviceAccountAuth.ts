import "server-only";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

class GoogleDriveAuthConfigurationError extends Error {
  constructor() {
    super(
      "Google Drive 서비스 계정 설정이 없습니다. GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL과 GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY를 설정해 주세요.",
    );
    this.name = "GoogleDriveAuthConfigurationError";
  }
}

function normalizePemKey(value: string) {
  const cleaned = value.replace(/\\n/g, "\n").trim();
  const header = "-----BEGIN PRIVATE KEY-----";
  const footer = "-----END PRIVATE KEY-----";
  if (cleaned.includes(header) && cleaned.includes(footer)) return cleaned;
  return `${header}\n${cleaned}\n${footer}`;
}

function getServiceAccountCredentials() {
  const email = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();
  if (!email || !privateKey) throw new GoogleDriveAuthConfigurationError();
  return { email, privateKey: normalizePemKey(privateKey) };
}

function decodePkcs8Der(pem: string) {
  const base64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  return Buffer.from(base64, "base64");
}

function base64UrlEncode(input: Uint8Array) {
  const binary = String.fromCharCode(...input);
  return Buffer.from(binary, "binary").toString("base64url");
}

/** 서비스 계정 인증으로 Drive 업로드 범위의 OAuth2 access token을 발급받습니다. */
export async function getGoogleDriveAccessToken(
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const { email, privateKey } = getServiceAccountCredentials();
  const now = Math.floor(Date.now() / 1000);

  const encodedHeader = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })),
  );
  const encodedPayload = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        iss: email,
        scope: DRIVE_SCOPE,
        aud: TOKEN_ENDPOINT,
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const keyData = decodePkcs8Der(privateKey);
  const imported = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    imported,
    new TextEncoder().encode(signingInput),
  );

  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`,
    }),
  });
  if (!response.ok) {
    throw new Error(`Google Drive 토큰 발급 실패: ${response.status}`);
  }
  const result = (await response.json()) as { access_token?: string };
  if (!result.access_token) {
    throw new Error("Google Drive 응답에 access_token이 없습니다.");
  }
  return result.access_token;
}
