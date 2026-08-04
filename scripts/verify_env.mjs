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

async function run() {
  console.log("🔍 환경 변수 및 멀티 클라우드 인증 검증 시작...\n");
  await verifySupabase();
  console.log("\n✨ 검증 완료");
}

run();
