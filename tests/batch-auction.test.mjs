import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
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
  );
  assert.notEqual(importableSource, originalSource, "Supabase 경로 별칭을 테스트 대역으로 교체해야 합니다.");

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
  status: "pending",
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
});

test("keeps workbook model limits, header tie-breaking, and picker reset guards", async () => {
  const [parser, modal] = await Promise.all([
    source("src/lib/import/batchAuction.ts"),
    source("src/components/admin/BulkAuctionImportModal.tsx"),
  ]);

  assert.match(parser, /MAX_WORKBOOK_BYTES = 10 \* 1024 \* 1024/);
  assert.match(parser, /MAX_RAW_WORKSHEET_ROWS = 1_000/);
  assert.match(parser, /MAX_WORKSHEET_COLUMNS = 256/);
  assert.match(
    parser,
    /candidate\.score === best\.candidate\.score[\s\S]*validDataRowCount > best\.validDataRowCount/,
  );
  assert.match(
    modal,
    /source === "directory"[\s\S]*multipleInputRef\.current[\s\S]*directoryInputRef\.current/,
  );
});
