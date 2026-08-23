import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("center mall uses a compact four-column desktop grid", async () => {
  const grid = await source(
    "src/components/features/catalog/StoreMallGrid.tsx",
  );
  assert.match(grid, /grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4/);
  assert.match(grid, /aspect-\[16\/10\]/);
  assert.match(grid, /size-11/);
  assert.match(grid, /conceptTags\.slice\(0,\s*2\)/);
});

test("MY renders persistent notification switches and aligns the Kakao badge", async () => {
  const [dashboard, preferences, profile] = await Promise.all([
    source("src/components/features/mypage/MyDashboard.tsx"),
    source("src/components/features/mypage/MyNotificationPreferences.tsx"),
    source("src/components/features/mypage/ProfileHeader.tsx"),
  ]);
  assert.match(dashboard, /MyNotificationPreferences/);
  assert.match(preferences, /role="switch"/);
  assert.match(preferences, /라이브 옥션 오픈 및 상위 입찰 알림/);
  assert.match(preferences, /보관함 만료 D-3 알림/);
  assert.match(preferences, /찜한 상품 가격 인하 알림/);
  assert.match(preferences, /savePreferences/);
  assert.match(profile, /-bottom-1 -right-1 translate-x-1 translate-y-1/);
});

test("operator store settings use three cards and one sticky save contract", async () => {
  const [ui, route, migration] = await Promise.all([
    source("src/components/operator/platform/StoreSettingsWorkspace.tsx"),
    source("src/app/api/admin/operator/platform/route.ts"),
    source(
      "supabase/migrations/20260822163735_enhance_operator_store_settings.sql",
    ),
  ]);
  assert.match(ui, /StoreBrandingCard/);
  assert.match(ui, /StoreBusinessCard/);
  assert.match(ui, /StoreShippingPolicyCard/);
  assert.match(ui, /sticky bottom-3/);
  assert.match(ui, /className="sr-only"/);
  assert.match(ui, /스토어 대표 배너 이미지/);
  assert.match(ui, /p\.message \?\?/);
  assert.match(ui, /매장 설정 불러오는 중/);
  assert.match(ui, /다시 시도/);
  assert.match(route, /save_operator_store_settings/);
  assert.match(route, /p_banner_url:body\.bannerUrl/);
  assert.match(route, /warnings/);
  assert.doesNotMatch(
    route,
    /feeError \|\| subscriptionError \|\| profileError/,
  );
  assert.match(route, /encryptAccountNumber/);
  assert.match(migration, /security definer set search_path=''/);
  assert.match(migration, /has_store_permission\(p_store_id,'manage_store'\)/);
  assert.match(migration, /store_payout_accounts/);
  assert.doesNotMatch(migration, /account_number\s+text/);
});

test("store banner uploader compresses into the existing scoped storage bucket", async () => {
  const uploader = await source(
    "src/components/common/StoreImageUploader.tsx",
  );
  assert.match(uploader, /compressProductImageForUpload/);
  assert.match(uploader, /from\("store-mall-images"\)/);
  assert.match(uploader, /`\$\{storeId\}\/\$\{kind\}-/);
  assert.match(uploader, /이미지를 업로드했습니다\. 변경사항을 저장해 적용해 주세요/);
  assert.doesNotMatch(uploader, /window\.alert/);
});

test("operator platform route has local loading and user-safe error boundaries", async () => {
  const [loading, error] = await Promise.all([
    source("src/app/(admin)/admin/operator/platform/loading.tsx"),
    source("src/app/(admin)/admin/operator/platform/error.tsx"),
  ]);
  assert.match(loading, /role="status"/);
  assert.match(loading, /animate-pulse/);
  assert.match(error, /role="alert"/);
  assert.match(error, /reset/);
  assert.doesNotMatch(error, /store_settings_unavailable/);
});
