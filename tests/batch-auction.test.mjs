import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ExcelJS from "exceljs";
import ts from "typescript";

const rootUrl = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

async function loadBatchAuctionModule() {
  const originalSource = await source("src/lib/import/batchAuction.ts");
  const runtimeImport =
    'import { isSupportedProductImageMimeType } from "@/src/lib/supabase/productImagePolicy";';
  const importableSource = originalSource.replace(
    runtimeImport,
    "const isSupportedProductImageMimeType = (mimeType: string) => /^image\\//i.test(mimeType);",
  ).replace(
    'await import("exceljs")',
    "globalThis.__batchAuctionExcelJS",
  );
  assert.notEqual(importableSource, originalSource, "Supabase 경로 별칭을 테스트 대역으로 교체해야 합니다.");
  globalThis.__batchAuctionExcelJS = { default: ExcelJS };

  const transpiled = ts.transpileModule(importableSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText;

  return import(
    `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}#${Date.now()}`
  );
}

async function templateWorkbookFile() {
  const workbook = new ExcelJS.Workbook();

  const addTemplateSheet = (name, productRows) => {
    const worksheet = workbook.addWorksheet(name);
    worksheet.getCell("A1").value = "상품명";
    worksheet.getCell("X1").value = "상품 설명";
    worksheet.getCell("Y1").value = "가격";
    worksheet.getCell("AH1").value = "이미지 파일명";

    // 실제 업로드 양식의 1~5행에는 헤더, 안내문, 예시 상품이 들어간다.
    worksheet.getCell("X2").value = "필수";
    worksheet.getCell("Y2").value = "조건부 필수";
    worksheet.getCell("X3").value = "10자부터 입력 가능합니다.";
    worksheet.getCell("A4").value = "양식 예시 상품 1";
    worksheet.getCell("X4").value = "등록되면 안 되는 예시 설명";
    worksheet.getCell("Y4").value = 10_000;
    worksheet.getCell("AH4").value = "example-one.jpg";
    worksheet.getCell("A5").value = "양식 예시 상품 2";
    worksheet.getCell("X5").value = "등록되면 안 되는 예시 설명";
    worksheet.getCell("Y5").value = 20_000;
    worksheet.getCell("AH5").value = "example-two.jpg";

    productRows.forEach((product, index) => {
      const rowNumber = index + 6;
      worksheet.getCell(`A${rowNumber}`).value = product.title;
      worksheet.getCell(`X${rowNumber}`).value = product.description;
      worksheet.getCell(`Y${rowNumber}`).value = product.price;
      worksheet.getCell(`AH${rowNumber}`).value = product.images;
    });
  };

  addTemplateSheet("다른 시트", [
    {
      title: "다른 상품",
      description: "다른 시트 설명",
      price: 5_000,
      images: "other.jpg",
    },
  ]);
  addTemplateSheet("경매 상품", [
    {
      title: "빈티지 코트",
      description: "코트 설명",
      price: 30_000,
      images: "coat-front.jpg, coat-back.jpg",
    },
    {
      title: "빈티지 셔츠",
      description: "셔츠 설명",
      price: 15_000,
      images: "shirt.jpg",
    },
  ]);

  const bytes = await workbook.xlsx.writeBuffer();
  return new File([bytes], "auction-template.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

async function fixedColumnWorkbookFile(headerLabels) {
  const workbook = new ExcelJS.Workbook();
  const genericSheet = workbook.addWorksheet("일반 헤더 시트");
  genericSheet.getCell("A1").value = "상품설명";
  genericSheet.getCell("B1").value = "시작가";
  genericSheet.getCell("C1").value = "이미지명";
  genericSheet.getCell("A6").value = "일반 양식 상품";
  genericSheet.getCell("B6").value = 1_000;
  genericSheet.getCell("C6").value = "generic.jpg";

  const fixedSheet = workbook.addWorksheet("고정 열 양식");
  if (headerLabels) {
    fixedSheet.getCell("A1").value = headerLabels.title;
    fixedSheet.getCell("X1").value = headerLabels.description;
    fixedSheet.getCell("Y1").value = headerLabels.price;
    fixedSheet.getCell("AH1").value = headerLabels.images;
  }
  fixedSheet.getCell("A6").value = "고정 양식 상품";
  fixedSheet.getCell("X6").value = "고정 열에서 읽은 설명";
  fixedSheet.getCell("Y6").value = 45_000;
  fixedSheet.getCell("AH6").value = "fixed.jpg";

  const bytes = await workbook.xlsx.writeBuffer();
  return new File([bytes], "fixed-columns.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function imageFile(relativePath) {
  const name = relativePath.split("/").at(-1);
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], name, {
    type: "image/jpeg",
    lastModified: 1,
  });
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
}

function workbookWithImageCell(imageCell) {
  return {
    fileName: "products.xlsx",
    sheetName: "상품",
    detectedHeaders: {
      sheetName: "상품",
      headerRowNumber: 1,
      description: { columnNumber: 1, header: "상품설명" },
      title: null,
      startingPrice: { columnNumber: 2, header: "시작가" },
      imageNames: [{ columnNumber: 3, header: "이미지명" }],
      duplicateFields: [],
      unusedHeaders: [],
    },
    rows: [{ rowNumber: 2, cells: ["빈티지 코트", 10_000, imageCell] }],
  };
}

const previewOptions = {
  publishAt: "2030-01-01T01:00:00.000Z",
  bidIncrement: 1_000,
};

test("normalizes unsupported Excel cell objects to null", async () => {
  const { normalizeWorkbookCellValue } = await loadBatchAuctionModule();

  assert.equal(normalizeWorkbookCellValue({ formula: "1 + 1" }), null);
  assert.equal(
    normalizeWorkbookCellValue({ sharedFormula: "A1", result: undefined }),
    null,
  );
  assert.equal(normalizeWorkbookCellValue({ formula: "1 + 1", result: 2 }), 2);
  assert.equal(
    normalizeWorkbookCellValue({ formula: "A1", result: { error: "#N/A" } }),
    null,
  );
  assert.equal(normalizeWorkbookCellValue({ error: "#VALUE!" }), null);
  assert.equal(normalizeWorkbookCellValue({ unknown: "object" }), null);
  assert.equal(
    normalizeWorkbookCellValue({ text: "링크 텍스트", hyperlink: "https://example.com" }),
    "링크 텍스트",
  );
});

test("detects the real template sheet and imports only rows 6 and later", async () => {
  const { FIRST_PRODUCT_ROW, parseAuctionWorkbook } =
    await loadBatchAuctionModule();
  const parsed = await parseAuctionWorkbook(await templateWorkbookFile());

  assert.equal(FIRST_PRODUCT_ROW, 6);
  assert.equal(parsed.sheetName, "경매 상품");
  assert.equal(parsed.detectedHeaders.title?.columnNumber, 1);
  assert.equal(parsed.detectedHeaders.description?.columnNumber, 24);
  assert.equal(parsed.detectedHeaders.startingPrice?.columnNumber, 25);
  assert.deepEqual(
    parsed.detectedHeaders.imageNames.map((column) => column.columnNumber),
    [34],
  );
  assert.deepEqual(
    parsed.rows.map((row) => row.rowNumber),
    [6, 7],
  );
});

test("prioritizes fixed A/X/Y/AH columns without relying on header names", async () => {
  const { parseAuctionWorkbook } = await loadBatchAuctionModule();
  const cases = [
    {
      name: "missing headers",
      labels: undefined,
      expectedHeaders: [
        "A열 상품명",
        "X열 상품 설명",
        "Y열 시작가",
        "AH열 이미지명",
      ],
    },
    {
      name: "renamed headers",
      labels: {
        title: "내부 상품 코드",
        description: "판매 상세 텍스트",
        price: "기준 금액",
        images: "사진 목록 문자열",
      },
      expectedHeaders: [
        "내부 상품 코드",
        "판매 상세 텍스트",
        "기준 금액",
        "사진 목록 문자열",
      ],
    },
  ];

  for (const testCase of cases) {
    const parsed = await parseAuctionWorkbook(
      await fixedColumnWorkbookFile(testCase.labels),
    );

    assert.equal(parsed.sheetName, "고정 열 양식", testCase.name);
    assert.deepEqual(
      [
        parsed.detectedHeaders.title?.columnNumber,
        parsed.detectedHeaders.description?.columnNumber,
        parsed.detectedHeaders.startingPrice?.columnNumber,
        parsed.detectedHeaders.imageNames[0]?.columnNumber,
      ],
      [1, 24, 25, 34],
      testCase.name,
    );
    assert.deepEqual(
      [
        parsed.detectedHeaders.title?.header,
        parsed.detectedHeaders.description?.header,
        parsed.detectedHeaders.startingPrice?.header,
        parsed.detectedHeaders.imageNames[0]?.header,
      ],
      testCase.expectedHeaders,
      testCase.name,
    );
    assert.deepEqual(
      parsed.rows.map((row) => row.rowNumber),
      [6],
      testCase.name,
    );
  }
});

test("requires a globally unique basename for a bare image reference", async () => {
  const { buildBatchAuctionPreview } = await loadBatchAuctionModule();
  const preview = buildBatchAuctionPreview(
    workbookWithImageCell("coat.jpg"),
    [imageFile("photos/coat.jpg"), imageFile("photos/sub/coat.jpg")],
    previewOptions,
  );

  assert.equal(preview.canSubmit, false);
  assert.ok(
    preview.rows[0].issues.some((issue) => issue.code === "ambiguous_image"),
  );
});

test("preserves comma-containing filenames and the Excel image order", async () => {
  const { buildBatchAuctionPreview } = await loadBatchAuctionModule();
  const commaFile = imageFile("photos/coat,front.jpg");
  const commaPreview = buildBatchAuctionPreview(
    workbookWithImageCell("coat,front.jpg"),
    [commaFile],
    previewOptions,
  );

  assert.equal(commaPreview.canSubmit, true);
  assert.deepEqual(commaPreview.rows[0].imageNames, ["coat,front.jpg"]);
  assert.equal(commaPreview.drafts[0].imageFiles[0], commaFile);

  const first = imageFile("photos/front.jpg");
  const second = imageFile("photos/back.jpg");
  const orderedPreview = buildBatchAuctionPreview(
    workbookWithImageCell("back.jpg\nfront.jpg"),
    [first, second],
    previewOptions,
  );

  assert.equal(orderedPreview.canSubmit, true);
  assert.deepEqual(
    orderedPreview.drafts[0].imageFiles.map((file) => file.name),
    ["back.jpg", "front.jpg"],
  );

  const third = imageFile("photos/side.jpg");
  const mixedSeparatorPreview = buildBatchAuctionPreview(
    workbookWithImageCell("back.jpg, front.jpg,\nside.jpg"),
    [first, second, third],
    previewOptions,
  );

  assert.equal(mixedSeparatorPreview.canSubmit, true);
  assert.deepEqual(mixedSeparatorPreview.rows[0].imageNames, [
    "back.jpg",
    "front.jpg",
    "side.jpg",
  ]);
  assert.deepEqual(
    mixedSeparatorPreview.drafts[0].imageFiles.map((file) => file.name),
    ["back.jpg", "front.jpg", "side.jpg"],
  );
});

test("keeps workbook model limits, header tie-breaking, and picker reset guards", async () => {
  const [parser, modal] = await Promise.all([
    source("src/lib/import/batchAuction.ts"),
    source("src/components/admin/BulkAuctionImportModal.tsx"),
  ]);

  assert.match(parser, /MAX_WORKBOOK_BYTES = 10 \* 1024 \* 1024/);
  assert.match(parser, /MAX_RAW_WORKSHEET_ROWS = 1_000/);
  assert.match(parser, /MAX_WORKSHEET_COLUMNS = 256/);
  assert.match(parser, /FIRST_PRODUCT_ROW = 6/);
  assert.match(
    parser,
    /candidate\.score === best\.candidate\.score[\s\S]*validDataRowCount > best\.validDataRowCount/,
  );
  assert.match(
    modal,
    /source === "directory"[\s\S]*multipleInputRef\.current[\s\S]*directoryInputRef\.current/,
  );
  assert.match(parser, /status: "pending"/);
  assert.match(modal, /getRelativeKoreanDateTime\(1, "10:00:00", now\)/);
  assert.match(modal, /1~5행은 양식 안내로 제외하고 6행부터/);
  assert.doesNotMatch(modal, /즉시 공개|status: "active"|publishMode/);
});
