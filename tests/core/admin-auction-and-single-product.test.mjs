import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("operator live auction pages are monitoring-only and reject mutation controls", async () => {
  const [consoleSource, liveOperations, liveRoute, productsRoute, migration] = await Promise.all([
    source("src/components/admin/operator/OperatorProductsConsole.tsx"),
    source("src/components/admin/operator/LiveAuctionOperations.tsx"),
    source("src/app/api/admin/operator/auctions/live/[id]/route.ts"),
    source("src/app/api/admin/operator/products/route.ts"),
    source("supabase/migrations/20260826231224_harden_live_auction_policy_v2.sql"),
  ]);

  assert.match(productsRoute, /canCloseAuctions:\s*auth\.roleCode === "owner"/);
  assert.doesNotMatch(consoleSource, /<AuctionController/);
  assert.doesNotMatch(liveOperations, /<AuctionController/);
  assert.match(liveOperations, /모니터링 전용/);
  assert.match(liveRoute, /authenticateOperatorStoreRequest\(request,\s*true\)/);
  assert.match(liveRoute, /operator_live_auction_mutation_forbidden/);
  assert.doesNotMatch(liveRoute, /operator_close_live_auction|operator_extend_live_auction|operator_cancel_auction_bid/);
  assert.match(migration, /revoke execute on function public\.operator_extend_live_auction/i);
  assert.match(migration, /revoke execute on function public\.operator_close_live_auction/i);
  assert.match(migration, /revoke execute on function public\.operator_cancel_auction_bid/i);
});

test("single product registration is separate, defaults to immediate publication, supports saved scheduling, and uploads up to 15 ordered files", async () => {
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
    source("src/app/(admin)/admin/operator/products/new/page.tsx"),
    source("supabase/migrations/20260724010000_remove_legacy_used_clothing_category.sql"),
  ]);

  assert.match(consoleSource, /일반 상품 등록[\s\S]*대량 등록/);
  assert.match(consoleSource, /엑셀 대량 등록/);
  assert.match(consoleSource, /즉시구매 상품 등록/);
  assert.match(consoleSource, /경매 상품 등록/);
  for (const step of ["STEP 1", "STEP 2", "STEP 3", "1. 상품 사진 선택", "2. 상품 정보", "3. 판매 정보", "4. 공개 설정"]) {
    assert.match(consoleSource, new RegExp(step.replace(".", "\\.")));
  }
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
  assert.match(consoleSource, /<GenderCategorySelect/);
  assert.doesNotMatch(consoleSource, /aria-label="브랜드"/);
  assert.doesNotMatch(consoleSource, /aria-label="사이즈"/);
  assert.doesNotMatch(consoleSource, /상태등급 미입력/);
  assert.match(
    consoleSource,
    /aria-label="상품명"[\s\S]*form\.saleType === "auction"[\s\S]*aria-label="경매 시작가"/,
  );
  assert.match(
    consoleSource,
    /<TextArea[\s\S]{0,80}aria-label="상품 설명"/,
  );
  assert.match(
    consoleSource,
    /form\.saleType === "auction" \? \([\s\S]*aria-label="입찰 단위"/,
  );
  assert.match(consoleSource, /bidIncrement:\s*"1000"/);
  assert.match(consoleSource, /aria-label="최소 입찰 단위"/);
  assert.match(
    consoleSource,
    /기본값은 1,000원이며 입력칸에서 상품별로 자유롭게 수정할 수\s*있습니다/,
  );
  assert.doesNotMatch(consoleSource, /입찰 최소 단위는 1,000원으로 자동 적용됩니다/);
  assert.equal(
    consoleSource.match(/aria-label="판매 방식"/g)?.length,
    1,
    "판매 방식 입력은 기존 상품 수정 폼에만 남아야 합니다.",
  );
  assert.match(consoleSource, /useState<PublicationMode>\("scheduled"\)/);
  assert.match(consoleSource, /getAvailablePublishSlots/);
  assert.match(consoleSource, /publishSlots\.map/);
  assert.match(consoleSource, /singleImages\.length \+ selected\.length > 15/);
  assert.match(consoleSource, /type="file"/);
  assert.match(consoleSource, /moveSingleImage\(index,\s*-1\)/);
  assert.match(consoleSource, /moveSingleImage\(index,\s*1\)/);
  assert.match(consoleSource, /removeSingleImage\(image\.id\)/);
  assert.match(consoleSource, /singleImages\.map\(\(image\) => image\.file\)/);

  assert.match(route, /registrationMode === "single"/);
  assert.match(route, /const title = text\(body\?\.title\)/);
  assert.match(route, /!title \|\|\s*title\.length > 160/);
  assert.match(route, /\(!singleRegistration && !description\)/);
  assert.match(route, /description\.length > 10000/);
  assert.match(route, /parseBrandAndSizeFromTitle\(title\)/);
  assert.match(route, /auth\.selectedStoreId/);
  assert.match(route, /const category = text\(body\?\.category, "기타"\)/);
  assert.doesNotMatch(route, /getRelativeKoreanDateTime\(1,\s*"10:00:00"/);
  assert.match(route, /getAvailablePublishSlots\(\)\[0\]\.value/);
  assert.match(route, /value\.length > 15/);
  assert.match(route, /p_permission:\s*"publish_products"/);
  assert.match(route, /size_label:[\s\S]*parsedTitle\.size/);
  assert.match(route, /inspection_notes:\s*Array\.isArray\(body\?\.inspectionNotes\)/);
  assert.match(consoleSource, /하자 상세 매핑/);
  assert.doesNotMatch(route, /구제 의류/);
  assert.match(categoryMigration, /alter column category set default '기타'/);
  assert.match(categoryMigration, /where btrim\(category\) in \('구제 의류', '구제의류'\)/);

  assert.doesNotMatch(dashboard, /products\?import=xlsx/);
  assert.doesNotMatch(dashboard, /products\?create=single/);
  assert.doesNotMatch(dashboard, /엑셀 일괄 등록|단품 등록/);
  assert.match(layout, /href:\s*"\/admin\/operator\/products"[\s\S]*label:\s*"상품 목록"/);
  assert.match(layout, /href:\s*"\/admin\/operator\/products\/new"[\s\S]*label:\s*"새 상품 등록"/);
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
  assert.match(consoleSource, /간편등록칸에서 다음 상품을 계속\s*등록할 수 있습니다/);
  assert.match(consoleSource, /setBlankSingleRegistration\(form\.saleType,\s*true\)/);
  assert.match(consoleSource, /바로 다음 \$\{snapshot\.form\.saleType/);
  assert.match(consoleSource, /beforeunload/);
  assert.match(consoleSource, /processingSingleRegistrationIdsRef/);
  assert.match(consoleSource, /retrySingleRegistration\(job\.id\)/);
  assert.match(consoleSource, /discardUnpersistedProductImages\(uploadedPaths\)/);
});
