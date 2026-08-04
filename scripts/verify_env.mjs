import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
  if (!match || process.env[match[1]]) continue;
  const raw = match[2].split("#")[0].trim();
  try {
    process.env[match[1]] = raw.startsWith('"') ? JSON.parse(raw) : raw.replace(/^'(.*)'$/, "$1");
  } catch {
    process.env[match[1]] = raw;
  }
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function verifySupabase() {
  if (!supabaseUrl || !supabaseKey) {
    console.log("❌ Supabase 인증 실패: 환경 변수(SUPABASE_URL 또는 SECRET_KEY)가 설정되지 않았습니다.");
    return;
  }
  try {
    const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/site_status?select=status&limit=1`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      console.log("✅ Supabase 연결 성공");
    } else {
      console.log(`❌ Supabase 인증 실패: HTTP 상태 코드 ${res.status}`);
    }
  } catch (err) {
    console.log(`❌ Supabase 인증 실패: ${err instanceof Error ? err.message : "네트워크 오류"}`);
  }
}

async function verifyGoogleDrive() {
  const email = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();

  if (!email || !privateKey) {
    console.log("ℹ️ Google Drive 서비스 계정이 설정되지 않아 검증을 건너뜁니다.");
    return;
  }

  try {
    // Basic JWT token request test
    const normalizePem = (val) => {
      const cleaned = val.replace(/\\n/g, "\n").trim();
      const header = "-----BEGIN PRIVATE KEY-----";
      const footer = "-----END PRIVATE KEY-----";
      return cleaned.includes(header) ? cleaned : `${header}\n${cleaned}\n${footer}`;
    };

    const pem = normalizePem(privateKey);
    const base64UrlEncode = (input) => Buffer.from(input).toString("base64url");

    const now = Math.floor(Date.now() / 1000);
    const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
    const payload = base64UrlEncode(
      new TextEncoder().encode(
        JSON.stringify({
          iss: email,
          scope: "https://www.googleapis.com/auth/drive.file",
          aud: "https://oauth2.googleapis.com/token",
          iat: now,
          exp: now + 3600,
        })
      )
    );
    const signingInput = `${header}.${payload}`;

    // Import key and sign
    const pemHeader = "-----BEGIN PRIVATE KEY-----";
    const pemFooter = "-----END PRIVATE KEY-----";
    const derBase64 = pem.replace(pemHeader, "").replace(pemFooter, "").replace(/\s+/g, "");
    const der = Buffer.from(derBase64, "base64");

    const imported = await crypto.subtle.importKey(
      "pkcs8",
      der,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      imported,
      new TextEncoder().encode(signingInput)
    );

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`,
      }),
    });

    if (!tokenRes.ok) {
      console.log(`❌ Google Drive 인증 실패: 토큰 발급 응답 코드 ${tokenRes.status}`);
      return;
    }

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.log("❌ Google Drive 인증 실패: access_token 누락");
      return;
    }

    console.log("✅ Google Drive 연결 성공");
  } catch (err) {
    console.log(`❌ Google Drive 인증 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`);
  }
}

async function run() {
  console.log("🔍 환경 변수 및 멀티 클라우드 인증 검증 시작...\n");
  await verifySupabase();
  await verifyGoogleDrive();
  console.log("\n✨ 검증 완료");
}

run();
