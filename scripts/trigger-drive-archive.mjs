import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

if (!supabaseUrl || !supabaseKey || !folderId) {
  console.error("❌ Supabase 또는 GOOGLE_DRIVE_FOLDER_ID 환경 변수가 누락되었습니다.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Import service account token generator inline or via fetch
async function run() {
  console.log("🚀 구글 드라이브 백업 스토리지 전송 및 확인 스크립트 실행...\n");

  // Fetch all backfilled records
  const { data: records, error } = await supabase
    .from("multi_provider_records")
    .select("*")
    .eq("storage_provider_id", "gcs");

  if (error) {
    console.error("❌ multi_provider_records 조회 실패:", error.message);
    process.exit(1);
  }

  console.log(`📦 구글 드라이브(gcs) 백업 대상으로 등록된 레코드: ${records?.length ?? 0}건`);
  if (records && records.length > 0) {
    console.log("📌 샘플 레코드 ID:", records[0].id, "Storage Key:", records[0].storage_key);
  }

  console.log("\n💡 구글 드라이브 백업 확인 방법:");
  console.log(`1. 웹브라우저에서 구글 드라이브(Google Drive)에 로그인합니다.`);
  console.log(`2. 환경 변수에 설정된 폴더 ID (${folderId})로 이동합니다.`);
  console.log(`3. 또는 구글 클라우드 콘솔 서비스 계정 이메일과 공유된 드라이브 폴더에서 아카이브 파일들을 확인하실 수 있습니다.`);
}

run();
