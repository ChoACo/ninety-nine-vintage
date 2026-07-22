import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ExcelJS from "exceljs";
import ts from "typescript";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

async function loadBatchAuctionModule() {
  const originalSource = await source("src/lib/import/batchAuction.ts");
  const importableSource = originalSource
    .replace(
      'import { isSupportedProductImageMimeType } from "@/src/lib/supabase/productImagePolicy";',
      "const isSupportedProductImageMimeType = (mimeType: string) => /^image\\//i.test(mimeType);",
    )
    .replace('await import("exceljs")', "globalThis.__operatorXlsxExcelJS");
  assert.notEqual(importableSource, originalSource);
  globalThis.__operatorXlsxExcelJS = { default: ExcelJS };
  const transpiled = ts.transpileModule(importableSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}#${Date.now()}`);
}

function imageFile(name) {
  return new File([new Uint8Array([0xff, 0xd8, 0xff])], name, {
    type: "image/jpeg",
    lastModified: 1,
  });
}

async function workbookFile({ condition = 2, price = 25_000, imageName = "boss.jpg" } = {}) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("상품 등록");
  worksheet.getCell("A1").value = "상품명";
  worksheet.getCell("D1").value = "사이즈 및 추천 사이즈";
  worksheet.getCell("W1").value = "상태점수";
  worksheet.getCell("X1").value = "상품 설명";
  worksheet.getCell("Y1").value = "시작가";
  worksheet.getCell("AH1").value = "이미지명";
  worksheet.getCell("A6").value = "[M] BOSS 빈티지 셔츠";
  worksheet.getCell("D6").value = "100 / 추천 M";
  worksheet.getCell("W6").value = condition;
  worksheet.getCell("X6").value = "기존 엑셀 원문";
  worksheet.getCell("Y6").value = price;
  worksheet.getCell("AH6").value = imageName;
  const bytes = await workbook.xlsx.writeBuffer();
  return new File([bytes], "상품-등록.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

test("operator XLSX UI parses in the browser, highlights Korean row errors, and requires explicit confirmation", async () => {
  const [modal, consoleSource, dashboard, parser, bulkRoute] = await Promise.all([
    source("src/components/admin/operator/OperatorXlsxImportModal.tsx"),
    source("src/components/admin/operator/OperatorProductsConsole.tsx"),
    source("src/components/admin/operator/OperatorConsole.tsx"),
    source("src/lib/import/batchAuction.ts"),
    source("src/app/api/admin/operator/products/bulk/route.ts"),
  ]);

  assert.match(parser, /await import\("exceljs"\)/);
  assert.match(modal, /parseAuctionWorkbook\(file\)/);
  assert.match(modal, /상품 행별 검증 미리보기/);
  assert.match(modal, /aria-invalid=\{hasRowError\}/);
  assert.match(modal, /검증 결과와 저장 대상을 확인했다는 항목에 체크해 주세요/);
  assert.match(modal, /disabled=\{!confirmed \|\| !preview\?\.canSubmit/);
  assert.match(modal, /이제 데이터베이스 저장을 허용합니다/);
  assert.match(modal, /<PremiumDialog/);
  assert.match(modal, /closeDisabled=\{isSubmitting\}/);
  assert.match(modal, /panelClassName="max-w-\[1180px\]"/);
  assert.match(modal, /panelViewportClassName="max-h-\[calc\(100dvh-2rem\)\]"/);
  assert.match(modal, /className="grid grid-cols-1 gap-4 lg:grid-cols-2"/);
  assert.match(modal, /확인 브랜드/);
  assert.match(modal, /inferBrandFromTitle\(row\.title\)\.brand/);
  assert.match(modal, /stores\.map\(\(store\)/);
  assert.match(modal, /기존 고정 양식만 사용합니다/);
  assert.match(modal, /A열 상품명[\s\S]*D열 사이즈[\s\S]*W열 상태점수[\s\S]*X열 원문[\s\S]*Y열 시작가[\s\S]*AH열 이미지명/);
  assert.doesNotMatch(modal, /setSaleType|즉시 구매/);

  assert.match(consoleSource, /uploadProductImages\(/);
  assert.match(consoleSource, /crypto\.randomUUID\(\)/);
  assert.match(consoleSource, /fetch\("\/api\/admin\/operator\/products\/bulk"/);
  assert.match(consoleSource, /discardUnpersistedProductImages\(uploadedPaths\)/);
  assert.match(consoleSource, /stores\.some\(\(store\) => store\.id === scopedStoreId\)/);
  assert.match(consoleSource, /get\("import"\) === "xlsx"/);
  assert.match(dashboard, /href="\/admin\/operator\/products\?import=xlsx"/);
  assert.match(dashboard, /엑셀 일괄 등록/);

  assert.match(bulkRoute, /authenticateStaffRequest\(request, true\)/);
  assert.match(bulkRoute, /auth\.user[\s\S]*\.from\("products"\)[\s\S]*\.insert/);
  assert.doesNotMatch(bulkRoute, /auth\.admin[\s\S]*\.from\("products"\)[\s\S]*\.insert/);
  assert.match(bulkRoute, /p_permission:\s*"manage_products"/);
  assert.doesNotMatch(bulkRoute, /effectiveOperatorId|operator_id/);
  assert.match(bulkRoute, /const normalizedBrand = normalizeProductBrand\(body\.brand\)/);
  assert.match(bulkRoute, /brand_source: "explicit"/);
  assert.match(bulkRoute, /thumbnail_urls: thumbnailUrls/);
});

test("golden XLSX parser accepts a valid row and reports Korean validation failures before save", async () => {
  const { buildBatchAuctionPreview, parseAuctionWorkbook } = await loadBatchAuctionModule();
  const parsed = await parseAuctionWorkbook(await workbookFile());
  const preview = buildBatchAuctionPreview(parsed, [imageFile("boss.jpg")], {
    publishAt: "2030-01-01T01:00:00.000Z",
    bidIncrement: 1_000,
  });

  assert.equal(preview.canSubmit, true);
  assert.equal(preview.rows[0].rowNumber, 6);
  assert.equal(preview.rows[0].title, "BOSS 빈티지 셔츠");
  assert.equal(preview.rows[0].condition, "상태 좋음");
  assert.equal(preview.rows[0].sourceDescription, "기존 엑셀 원문");
  assert.equal(preview.drafts[0].saleType, "auction");
  assert.equal(preview.drafts[0].fixedPrice, null);
  assert.equal(preview.drafts[0].status, "pending");

  const invalidParsed = await parseAuctionWorkbook(await workbookFile({
    condition: 9,
    price: 0,
    imageName: "missing.jpg",
  }));
  const invalid = buildBatchAuctionPreview(invalidParsed, [imageFile("other.jpg")], {
    publishAt: "2030-01-01T01:00:00.000Z",
    bidIncrement: 1_000,
  });

  assert.equal(invalid.canSubmit, false);
  const messages = invalid.rows[0].issues.map((issue) => issue.message).join("\n");
  assert.match(messages, /W열 상태점수/);
  assert.match(messages, /시작가는 1원 이상/);
  assert.match(messages, /사진을 찾지 못했습니다/);
});

test("parser rejects a rewritten generic spreadsheet instead of changing the existing fixed-column contract", async () => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("새 양식");
  worksheet.addRow(["title", "description", "startingPrice", "imageNames"]);
  worksheet.addRow(["임의 상품", "임의 설명", 25_000, "arbitrary.jpg"]);
  const bytes = await workbook.xlsx.writeBuffer();
  const file = new File([bytes], "rewritten.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const { parseAuctionWorkbook } = await loadBatchAuctionModule();

  await assert.rejects(
    () => parseAuctionWorkbook(file),
    /기존 Excel 고정 양식\(A\/D\/W\/X\/Y\/AH 열, 6행 시작\)/,
  );
});

test("preview rejects more images than the guarded bulk API accepts", async () => {
  const { buildBatchAuctionPreview, parseAuctionWorkbook } = await loadBatchAuctionModule();
  const names = Array.from({ length: 13 }, (_, index) => `image-${index + 1}.jpg`);
  const parsed = await parseAuctionWorkbook(await workbookFile({ imageName: names.join("\n") }));
  const preview = buildBatchAuctionPreview(parsed, names.map(imageFile), {
    publishAt: "2030-01-01T01:00:00.000Z",
    bidIncrement: 1_000,
  });

  assert.equal(preview.canSubmit, false);
  assert.ok(preview.rows[0].issues.some((issue) => issue.code === "too_many_product_images"));
  assert.match(
    preview.rows[0].issues.find((issue) => issue.code === "too_many_product_images").message,
    /최대 12장/,
  );
});
