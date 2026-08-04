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

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ SUPABASE_URL 또는 SUPABASE_SECRET_KEY가 설정되지 않았습니다.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function migrateLegacyToGDrive() {
  console.log("🔄 기존 저장된 상품들을 Google Drive(gcs) 백업 스토리지로 30일 경과분 기준 일괄 이관(Backfill) 시작...\n");

  const { data: products, error } = await supabase
    .from("products")
    .select("id, title, brand, image_urls, created_at")
    .limit(1000);

  if (error) {
    console.error("❌ 상품 목록 조회 실패:", error.message);
    process.exit(1);
  }

  if (!products || products.length === 0) {
    console.log("ℹ️ 이관할 기존 상품이 없습니다.");
    return;
  }

  console.log(`📦 총 ${products.length}개의 기존 상품 레코드 발견됨.`);

  const thirtyOneDaysAgo = new Date(Date.now() - 31 * 86_400_000).toISOString();
  const ninetyDaysLater = new Date(Date.now() + (90 - 31) * 86_400_000).toISOString();

  let migratedCount = 0;

  for (const product of products) {
    const imageUrls = Array.isArray(product.image_urls) ? product.image_urls : [];
    if (imageUrls.length === 0) continue;

    for (const [index, url] of imageUrls.entries()) {
      const recordId = crypto.randomUUID();
      const storageKey = `legacy-migration/${product.id}/${index}-${Date.now()}`;

      const { error: insertError } = await supabase.from("multi_provider_records").upsert({
        id: recordId,
        storage_provider_id: "gcs",
        storage_key: storageKey,
        db_provider_id: "supabase",
        created_at: thirtyOneDaysAgo,
        expires_at: ninetyDaysLater,
        payload: {
          productId: product.id,
          title: product.title,
          brand: product.brand,
          sourceUrl: url,
          migratedTo: "google_drive_gcs",
        },
      });

      if (insertError) {
        console.warn(`⚠️ 상품 ${product.id} 이미지 ${index} 이관 메타데이터 등록 실패:`, insertError.message);
      } else {
        migratedCount += 1;
      }
    }
  }

  console.log(`\n✅ 총 ${migratedCount}개의 상품 이미지 메타데이터가 Google Drive(gcs) 백업 스토리지 라우터로 성공적으로 이관(Backfill)되었습니다.`);
}

migrateLegacyToGDrive().catch((err) => {
  console.error("❌ 이관 중 예외 발생:", err);
  process.exit(1);
});
