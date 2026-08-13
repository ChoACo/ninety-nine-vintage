import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("owner product feed exposes an audited immediate auction close and winner action", async () => {
  const [consoleSource, closeRoute, productsRoute, migration] = await Promise.all([
    source("src/components/admin/operator/OperatorProductsConsole.tsx"),
    source("src/app/api/admin/operator/products/[id]/close-now/route.ts"),
    source("src/app/api/admin/operator/products/route.ts"),
    source("supabase/migrations/20260718061000_add_auction_lifecycle_controls.sql"),
  ]);

  assert.match(productsRoute, /canCloseAuctions:\s*auth\.roleCode === "owner"/);
  assert.match(consoleSource, /즉시 마감·낙찰 확정/);
  assert.match(consoleSource, /permissions\.canCloseAuctions/);
  assert.match(consoleSource, /\/close-now/);
  assert.match(closeRoute, /authenticateOperatorStoreRequest\(request,\s*true\)/);
  assert.match(closeRoute, /auth\.roleCode !== "owner"/);
  assert.match(closeRoute, /auth\.user[\s\S]*\.rpc\("owner_close_auction_now"/);
  assert.doesNotMatch(closeRoute, /auth\.admin[\s\S]*\.from\("products"\)/);
  assert.match(migration, /order by bids\.amount desc,\s*bids\.created_at,\s*bids\.id/i);
  assert.match(migration, /owner_auction_action_audit/i);
});

test("single product registration is separate, scheduled by saved hourly preference, and uploads up to 15 ordered files", async () => {
  const [
    consoleSource,
    route,
    dashboard,
    layout,
    activePage,
    registrationPage,
    categoryMigration,
  ] = await Promise.all([
    source("src/components/admin/operator/OperatorProductsConsole.tsx"),
    source("src/app/api/admin/operator/products/route.ts"),
    source("src/components/admin/operator/OperatorConsole.tsx"),
    source("src/app/(admin)/admin/operator/layout.tsx"),
    source("src/app/(admin)/admin/operator/products/page.tsx"),
    source("src/app/(admin)/admin/operator/products/registration/page.tsx"),
    source("supabase/migrations/20260724010000_remove_legacy_used_clothing_category.sql"),
  ]);

  assert.match(consoleSource, /엑셀 일괄 등록[\s\S]*variant="primary"/);
  assert.match(consoleSource, /즉시구매 간편등록/);
  assert.match(consoleSource, /경매 간편등록/);
  assert.match(consoleSource, /const singleRegistrationSubmitLabel/);
  assert.ok(
    consoleSource.indexOf("{singleRegistrationSubmitLabel}")
      < consoleSource.indexOf("1. 상품 사진 선택"),
    "간편등록 실행 버튼은 사진 선택 영역보다 위에 있어야 합니다.",
  );
  assert.ok(
    consoleSource.indexOf("1. 상품 사진 선택")
      < consoleSource.indexOf('placeholder="상품명 (필수)"'),
  );
  assert.match(consoleSource, /브랜드 \(선택\)/);
  assert.match(consoleSource, /카테고리 미입력/);
  assert.match(consoleSource, /사이즈 \(선택\)/);
  assert.doesNotMatch(consoleSource, /상태등급 미입력/);
  assert.match(
    consoleSource,
    /aria-label="상품명"[\s\S]*form\.saleType === "auction"[\s\S]*aria-label="경매 시작가"/,
  );
  assert.match(
    consoleSource,
    /<TextArea aria-label="상품 설명"/,
  );
  assert.doesNotMatch(
    consoleSource,
    /form\.saleType === "auction" \? <TextInput aria-label="입찰 단위"/,
  );
  assert.match(consoleSource, /bidIncrement:\s*"1000"/);
  assert.match(consoleSource, /입찰 최소 단위는 1,000원으로 자동 적용됩니다/);
  assert.equal(
    consoleSource.match(/aria-label="판매 방식"/g)?.length,
    1,
    "판매 방식 입력은 기존 상품 수정 폼에만 남아야 합니다.",
  );
  assert.match(consoleSource, /useState<PublicationMode>\("scheduled"\)/);
  assert.match(consoleSource, /예약 공개 \(기본\)/);
  assert.match(consoleSource, /Array\.from\(\{ length: 24 \}/);
  assert.match(consoleSource, /singleImages\.length \+ selected\.length > 15/);
  assert.match(consoleSource, /type="file"/);
  assert.match(consoleSource, /moveSingleImage\(index,\s*-1\)/);
  assert.match(consoleSource, /moveSingleImage\(index,\s*1\)/);
  assert.match(consoleSource, /removeSingleImage\(image\.id\)/);
  assert.match(consoleSource, /singleImages\.map\(\(image\) => image\.file\)/);

  assert.match(route, /registrationMode === "single"/);
  assert.match(route, /const title = text\(body\?\.title\)/);
  assert.match(route, /!title \|\| title\.length > 160/);
  assert.match(route, /\(!singleRegistration && !description\)/);
  assert.match(route, /description\.length > 10000/);
  assert.match(route, /normalizeProductBrand\("빈티지"\)/);
  assert.match(route, /const gender = \["남성", "여성", "공용"\]/);
  assert.match(route, /const category = text\(body\?\.category, "기타"\)/);
  assert.match(route, /getRelativeKoreanDateTime\(1,\s*"10:00:00"/);
  assert.match(route, /value\.length > 15/);
  assert.match(route, /p_permission:\s*"publish_products"/);
  assert.match(route, /size_label:\s*text\(body\?\.sizeLabel\)/);
  assert.match(route, /inspection_notes:\s*singleRegistration[\s\S]*\?\s*\[\]/);
  assert.doesNotMatch(route, /구제 의류/);
  assert.match(categoryMigration, /alter column category set default '기타'/);
  assert.match(categoryMigration, /where btrim\(category\) in \('구제 의류', '구제의류'\)/);

  assert.doesNotMatch(dashboard, /products\?import=xlsx/);
  assert.doesNotMatch(dashboard, /products\?create=single/);
  assert.doesNotMatch(dashboard, /엑셀 일괄 등록|단품 등록/);
  assert.match(layout, /href:\s*"\/admin\/operator\/products"[\s\S]*label:\s*"상품 관리"/);
  assert.match(layout, /href:\s*"\/admin\/operator\/products\/registration"[\s\S]*label:\s*"상품 등록"/);
  assert.match(activePage, /<OperatorProductsConsole view="active"\s*\/>/);
  assert.match(registrationPage, /<OperatorProductsConsole view="registration"\s*\/>/);
  assert.match(consoleSource, /product\.status === "active"[\s\S]*product\.sale_type === filter\.saleType/);
  assert.match(consoleSource, /aria-label="진행 상품 판매 방식"/);
  assert.match(consoleSource, /즉시구매 상품/);
  assert.match(consoleSource, /경매 상품/);
  assert.match(consoleSource, /aria-label="상품 등록 상태"/);
  assert.match(consoleSource, /업로드 예정/);
  assert.match(consoleSource, /registrationStage === "scheduled"/);
});

test("single registration resets immediately and finishes safely in the background", async () => {
  const consoleSource = await source(
    "src/components/admin/operator/OperatorProductsConsole.tsx",
  );

  assert.match(
    consoleSource,
    /const snapshot: SingleRegistrationSnapshot[\s\S]*prepareNextSingleRegistration\(\);[\s\S]*void processSingleRegistration\(snapshot\);[\s\S]*return;/,
  );
  assert.doesNotMatch(
    consoleSource,
    /await processSingleRegistration\(snapshot\)/,
  );
  assert.match(consoleSource, /단품 백그라운드 저장/);
  assert.match(consoleSource, /건 처리 중/);
  assert.match(consoleSource, /간편등록칸에서 다음 상품을 계속 등록할 수 있습니다/);
  assert.match(consoleSource, /setBlankSingleRegistration\(form\.saleType,\s*true\)/);
  assert.match(consoleSource, /바로 다음 \$\{snapshot\.form\.saleType/);
  assert.match(consoleSource, /beforeunload/);
  assert.match(consoleSource, /processingSingleRegistrationIdsRef/);
  assert.match(consoleSource, /retrySingleRegistration\(job\.id\)/);
  assert.match(consoleSource, /discardUnpersistedProductImages\(uploadedPaths\)/);
});
