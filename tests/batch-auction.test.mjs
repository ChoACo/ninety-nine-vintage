import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ExcelJS from "exceljs";
import ts from "typescript";
import { getNextAuctionPublishAt } from "../src/utils/formatters.ts";

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

async function fixedContentWorkbookFile() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("상품 본문 양식");
  worksheet.getCell("A1").value = "상품명";
  worksheet.getCell("D1").value = "사이즈 및 추천 사이즈";
  worksheet.getCell("W1").value = "상태점수";
  worksheet.getCell("X1").value = "기존 상품 설명";
  worksheet.getCell("Y1").value = "시작가";
  worksheet.getCell("AH1").value = "이미지명";

  const products = [
    ["[S] BOSS 셔츠 화이트", "95\n 추천   S ~ M", 1, "기존 설명 1", 10_000, "boss.jpg"],
    ["[XL] Code:graphy 셔츠 네이비", "105 / 추천 XL", "2", "기존 설명 2", 20_000, "codegraphy.jpg"],
    ["[M] 빈티지 데님", "100 / 추천 M", 4, "기존 설명 3", 30_000, "denim.jpg"],
    ["BOSS [L] 체크 셔츠", "100 / 추천 L", 3, "기존 설명 4", 40_000, "check.jpg"],
    ["[F] 실크 스카프", "FREE", 5, "기존 설명 5", 50_000, "scarf.jpg"],
  ];

  products.forEach(([title, size, conditionScore, description, price, image], index) => {
    const rowNumber = index + 6;
    worksheet.getCell(`A${rowNumber}`).value = title;
    worksheet.getCell(`D${rowNumber}`).value = size;
    worksheet.getCell(`W${rowNumber}`).value = conditionScore;
    worksheet.getCell(`X${rowNumber}`).value = description;
    worksheet.getCell(`Y${rowNumber}`).value = price;
    worksheet.getCell(`AH${rowNumber}`).value = image;
  });

  const bytes = await workbook.xlsx.writeBuffer();
  return new File([bytes], "fixed-content.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

async function preferredFixedContentWorkbookFile() {
  const workbook = new ExcelJS.Workbook();
  const addSheet = (name, { withSizeAndCondition }) => {
    const worksheet = workbook.addWorksheet(name);
    worksheet.getCell("A1").value = "상품명";
    worksheet.getCell("X1").value = "상품 설명";
    worksheet.getCell("Y1").value = "시작가";
    worksheet.getCell("AH1").value = "이미지명";
    worksheet.getCell("A6").value = `${name} 상품`;
    worksheet.getCell("X6").value = `${name} 설명`;
    worksheet.getCell("Y6").value = 10_000;
    worksheet.getCell("AH6").value = `${name}.jpg`;
    if (withSizeAndCondition) {
      worksheet.getCell("D1").value = "사이즈 및 추천 사이즈";
      worksheet.getCell("W1").value = "상태점수";
      worksheet.getCell("D6").value = "100 / 추천 M";
      worksheet.getCell("W6").value = 3;
    }
  };

  addSheet("구형 양식", { withSizeAndCondition: false });
  addSheet("신규 양식", { withSizeAndCondition: true });

  const bytes = await workbook.xlsx.writeBuffer();
  return new File([bytes], "preferred-fixed-content.xlsx", {
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
  assert.equal(parsed.detectedHeaders.size?.columnNumber, 4);
  assert.equal(parsed.detectedHeaders.conditionScore?.columnNumber, 23);
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

test("prioritizes fixed A/D/W/X/Y/AH columns without relying on header names", async () => {
  const { parseAuctionWorkbook } = await loadBatchAuctionModule();
  const cases = [
    {
      name: "missing headers",
      labels: undefined,
      expectedHeaders: [
        "A열 상품명",
        "D열 사이즈",
        "W열 상태점수",
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
        "D열 사이즈",
        "W열 상태점수",
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
        parsed.detectedHeaders.size?.columnNumber,
        parsed.detectedHeaders.conditionScore?.columnNumber,
        parsed.detectedHeaders.description?.columnNumber,
        parsed.detectedHeaders.startingPrice?.columnNumber,
        parsed.detectedHeaders.imageNames[0]?.columnNumber,
      ],
      [1, 4, 23, 24, 25, 34],
      testCase.name,
    );
    assert.deepEqual(
      [
        parsed.detectedHeaders.title?.header,
        parsed.detectedHeaders.size?.header,
        parsed.detectedHeaders.conditionScore?.header,
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

test("builds fixed-template product bodies from A, D, and W while retaining X only as source", async () => {
  const { buildBatchAuctionPreview, parseAuctionWorkbook } =
    await loadBatchAuctionModule();
  const parsed = await parseAuctionWorkbook(await fixedContentWorkbookFile());
  const preview = buildBatchAuctionPreview(
    parsed,
    [
      imageFile("photos/boss.jpg"),
      imageFile("photos/codegraphy.jpg"),
      imageFile("photos/denim.jpg"),
      imageFile("photos/check.jpg"),
      imageFile("photos/scarf.jpg"),
    ],
    previewOptions,
  );

  assert.equal(preview.canSubmit, true);
  assert.deepEqual(
    preview.rows.map((row) => row.title),
    [
      "BOSS 셔츠 화이트",
      "Code:graphy 셔츠 네이비",
      "빈티지 데님",
      "BOSS [L] 체크 셔츠",
      "실크 스카프",
    ],
    "맨 앞의 대괄호 토큰 하나만 제거해야 합니다.",
  );
  assert.deepEqual(
    preview.rows.map((row) => row.condition),
    ["새상품", "상태 좋음", "사용감 있음", null, null],
  );
  assert.equal(
    preview.drafts[0].description,
    "Name: BOSS 셔츠 화이트\nSize : 95 추천 S ~ M\n상품상태: 새상품",
  );
  assert.equal(preview.rows[0].size, "95 추천 S ~ M");
  assert.equal(
    preview.drafts[1].description,
    "Name: Code:graphy 셔츠 네이비\nSize : 105 / 추천 XL\n상품상태: 상태 좋음",
  );
  assert.equal(
    preview.drafts[2].description,
    "Name: 빈티지 데님\nSize : 100 / 추천 M\n상품상태: 사용감 있음",
  );
  assert.equal(
    preview.drafts[3].description,
    "Name: BOSS [L] 체크 셔츠\nSize : 100 / 추천 L",
    "상태점수 3은 상품상태 줄을 표시하지 않아야 합니다.",
  );
  assert.equal(
    preview.drafts[4].description,
    "Name: 실크 스카프\nSize : FREE",
    "상태점수 5는 상품상태 줄을 표시하지 않아야 합니다.",
  );
  assert.deepEqual(
    preview.rows.map((row) => row.sourceDescription),
    ["기존 설명 1", "기존 설명 2", "기존 설명 3", "기존 설명 4", "기존 설명 5"],
  );
  assert.ok(
    preview.drafts.every((draft) => !draft.description.includes("기존 설명")),
    "X열 원문은 공개 상품 본문에 포함하지 않아야 합니다.",
  );
});

test("rejects a fixed-template row when cleaned A or required D content is empty", async () => {
  const { buildBatchAuctionPreview, parseAuctionWorkbook } =
    await loadBatchAuctionModule();
  const parsed = await parseAuctionWorkbook(await fixedContentWorkbookFile());
  parsed.rows[0].cells[0] = "[S]";
  parsed.rows[0].cells[3] = null;

  const preview = buildBatchAuctionPreview(
    parsed,
    [
      imageFile("photos/boss.jpg"),
      imageFile("photos/codegraphy.jpg"),
      imageFile("photos/denim.jpg"),
      imageFile("photos/check.jpg"),
      imageFile("photos/scarf.jpg"),
    ],
    previewOptions,
  );

  assert.equal(preview.canSubmit, false);
  assert.ok(
    preview.rows[0].issues.some((issue) => issue.code === "missing_title"),
  );
  assert.ok(
    preview.rows[0].issues.some((issue) => issue.code === "missing_size"),
  );
});

test("rejects empty and out-of-range W scores while accepting only 1 through 5", async () => {
  const { buildBatchAuctionPreview, parseAuctionWorkbook } =
    await loadBatchAuctionModule();
  const parsed = await parseAuctionWorkbook(await fixedContentWorkbookFile());
  const invalidScores = [null, 0, 6, "임의문자", "1.0"];
  parsed.rows.forEach((row, index) => {
    row.cells[22] = invalidScores[index];
  });

  const preview = buildBatchAuctionPreview(
    parsed,
    [
      imageFile("photos/boss.jpg"),
      imageFile("photos/codegraphy.jpg"),
      imageFile("photos/denim.jpg"),
      imageFile("photos/check.jpg"),
      imageFile("photos/scarf.jpg"),
    ],
    previewOptions,
  );

  assert.equal(preview.canSubmit, false);
  preview.rows.forEach((row) => {
    assert.ok(
      row.issues.some((issue) => issue.code === "invalid_condition_score"),
      `${row.rowNumber}행의 잘못된 W열 값은 오류여야 합니다.`,
    );
  });
});

test("prefers complete D and W fixed data over a legacy X-only sheet", async () => {
  const { parseAuctionWorkbook } = await loadBatchAuctionModule();
  const parsed = await parseAuctionWorkbook(
    await preferredFixedContentWorkbookFile(),
  );

  assert.equal(parsed.sheetName, "신규 양식");
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].cells[3], "100 / 추천 M");
  assert.equal(parsed.rows[0].cells[22], 3);
});

test("preserves a leading bracket label in generic non-fixed imports", async () => {
  const { buildBatchAuctionPreview } = await loadBatchAuctionModule();
  const workbook = workbookWithImageCell("coat.jpg");
  workbook.rows[0].cells[0] = "[Vintage] 별도 헤더 코트";

  const preview = buildBatchAuctionPreview(
    workbook,
    [imageFile("photos/coat.jpg")],
    previewOptions,
  );

  assert.equal(preview.canSubmit, true);
  assert.equal(preview.drafts[0].title, "[Vintage] 별도 헤더 코트");
  assert.equal(preview.drafts[0].description, "[Vintage] 별도 헤더 코트");
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
  assert.match(modal, /getNextAuctionPublishAt\(now\)\.toISOString\(\)/);
  assert.match(modal, /1~5행은 양식 안내로 제외하고 6행부터/);
  assert.match(modal, /A열 상품명, D열 사이즈·추천 사이즈, W열/);
  assert.match(modal, /W열에는 1~5 중 하나를 입력해야 합니다/);
  assert.match(modal, /1=새상품, 2=상태[\s\S]*좋음, 4=사용감 있음/);
  assert.doesNotMatch(modal, /즉시 공개|status: "active"|publishMode/);
});

test("schedules pending products for the nearest KST 10:00 boundary", () => {
  assert.equal(
    getNextAuctionPublishAt("2026-07-18T00:59:59.999Z").toISOString(),
    "2026-07-18T01:00:00.000Z",
    "KST 오전 10시 전에는 당일 오전 10시여야 합니다.",
  );
  assert.equal(
    getNextAuctionPublishAt("2026-07-18T01:00:00.000Z").toISOString(),
    "2026-07-19T01:00:00.000Z",
    "KST 오전 10시부터는 다음 날 오전 10시여야 합니다.",
  );
  assert.equal(
    getNextAuctionPublishAt("2026-07-31T14:59:59.000Z").toISOString(),
    "2026-08-01T01:00:00.000Z",
    "한국 달력의 월 경계를 올바르게 넘어야 합니다.",
  );
});

test("publishes selected pending queue rows through one bounded operator RPC", async () => {
  const [migration, repository, adminPage] = await Promise.all([
    source("supabase/migrations/20260718063000_publish_pending_products_now.sql"),
    source("src/lib/supabase/products.ts"),
    source("src/components/admin/AdminPage.tsx"),
  ]);

  assert.match(migration, /cardinality\(p_product_ids\) > 200/);
  assert.match(migration, /group by input_values\.product_id/);
  assert.match(migration, /not in \('owner', 'operator'\)/);
  assert.match(migration, /products\.status = 'pending'/);
  assert.match(migration, /status = 'active'/);
  assert.match(migration, /time '21:00:00'/);
  assert.match(migration, /published_ids uuid\[\]/);
  assert.match(migration, /skipped_ids uuid\[\]/);
  assert.match(repository, /rpc\("publish_pending_products_now"/);
  assert.match(adminPage, /지금 즉시 올리기/);
  assert.match(adminPage, /selectedPendingProductIds/);
  assert.match(adminPage, /이미 상태가 바뀌었거나 찾을 수 없는/);
});
