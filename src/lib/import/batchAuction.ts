import type { NewAuctionDraft } from "@/src/components/feed/NewAuctionModal";
import { isSupportedProductImageMimeType } from "@/src/lib/supabase/productImagePolicy";

export type BatchAuctionCanonicalField =
  | "description"
  | "title"
  | "startingPrice"
  | "imageNames";

export type BatchAuctionIssueSeverity = "error" | "warning";

export type BatchAuctionProgressPhase = "uploading" | "saving";

export type BatchAuctionProgressReporter = (
  completed: number,
  total: number,
  phase: BatchAuctionProgressPhase,
) => void;

export interface BatchAuctionIssue {
  code: string;
  message: string;
  severity: BatchAuctionIssueSeverity;
}

export interface DetectedHeaderColumn {
  columnNumber: number;
  header: string;
}

export interface DetectedAuctionHeaders {
  sheetName: string;
  headerRowNumber: number;
  description: DetectedHeaderColumn | null;
  title: DetectedHeaderColumn | null;
  startingPrice: DetectedHeaderColumn | null;
  imageNames: DetectedHeaderColumn[];
  duplicateFields: Array<{
    field: Exclude<BatchAuctionCanonicalField, "imageNames">;
    columns: DetectedHeaderColumn[];
  }>;
  unusedHeaders: DetectedHeaderColumn[];
}

export type ParsedWorkbookCell = string | number | boolean | Date | null;

export interface ParsedAuctionWorkbookRow {
  rowNumber: number;
  cells: ParsedWorkbookCell[];
}

export interface ParsedAuctionWorkbook {
  fileName: string;
  sheetName: string;
  detectedHeaders: DetectedAuctionHeaders;
  rows: ParsedAuctionWorkbookRow[];
}

export interface BatchAuctionDraftOptions {
  status: NewAuctionDraft["status"];
  publishAt: string;
  bidIncrement: number;
}

export type ImageMatchStrategy = "relative-path" | "basename" | "unique-stem";

export interface BatchAuctionImageMatch {
  reference: string;
  file: File;
  strategy: ImageMatchStrategy;
}

export interface BatchAuctionPreviewRow {
  rowNumber: number;
  title: string;
  description: string;
  startingPrice: number | null;
  imageNames: string[];
  imageMatches: BatchAuctionImageMatch[];
  issues: BatchAuctionIssue[];
  draft: NewAuctionDraft | null;
}

export interface BatchAuctionPreview {
  rows: BatchAuctionPreviewRow[];
  globalIssues: BatchAuctionIssue[];
  unusedImageFiles: File[];
  drafts: NewAuctionDraft[];
  canSubmit: boolean;
}

const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_ROWS = 200;
const MAX_RAW_WORKSHEET_ROWS = 1_000;
const MAX_WORKSHEET_COLUMNS = 256;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const HEADER_SCAN_LIMIT = 30;

const HEADER_ALIASES: Record<BatchAuctionCanonicalField, readonly string[]> = {
  description: [
    "상품설명",
    "설명",
    "상세설명",
    "상세내용",
    "상품내용",
    "description",
    "detail",
    "details",
  ],
  title: [
    "상품명",
    "상품제목",
    "제목",
    "품명",
    "title",
    "productname",
    "name",
  ],
  startingPrice: [
    "시작가",
    "시작가격",
    "경매시작가",
    "최저가",
    "startingprice",
    "startprice",
    "startingbid",
  ],
  imageNames: [
    "이미지명",
    "이미지파일명",
    "이미지파일",
    "사진명",
    "사진파일명",
    "사진파일",
    "이미지",
    "사진",
    "imagename",
    "imagenames",
    "imagefile",
    "imagefiles",
    "images",
    "photo",
    "photos",
    "filename",
    "filenames",
  ],
};

const NORMALIZED_HEADER_ALIASES = Object.fromEntries(
  Object.entries(HEADER_ALIASES).map(([field, aliases]) => [
    field,
    new Set(aliases.map(normalizeHeader)),
  ]),
) as Record<BatchAuctionCanonicalField, Set<string>>;

function normalizeHeader(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[\s_\-()[\]{}./\\]+/g, "");
}

export function normalizeWorkbookCellValue(
  value: unknown,
): ParsedWorkbookCell {
  if (value === null || value === undefined || value === "") return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value instanceof Date
  ) {
    return value;
  }

  if (typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  if ("result" in record) return normalizeWorkbookCellValue(record.result);
  if (
    "formula" in record ||
    "sharedFormula" in record ||
    "error" in record
  ) {
    return null;
  }
  if (typeof record.text === "string") return record.text;
  if (Array.isArray(record.richText)) {
    return record.richText
      .map((part) =>
        part && typeof part === "object" && "text" in part
          ? String((part as { text?: unknown }).text ?? "")
          : "",
      )
      .join("");
  }
  return null;
}

function cellAsText(value: ParsedWorkbookCell | undefined): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function detectCanonicalField(header: string): BatchAuctionCanonicalField | null {
  const normalized = normalizeHeader(header);
  if (!normalized) return null;

  for (const field of Object.keys(
    NORMALIZED_HEADER_ALIASES,
  ) as BatchAuctionCanonicalField[]) {
    if (NORMALIZED_HEADER_ALIASES[field].has(normalized)) return field;
  }

  if (
    /^(이미지|사진|image|photo)(파일)?(명)?\d+$/.test(normalized) ||
    /^(image|photo)\d+(name|file)?$/.test(normalized)
  ) {
    return "imageNames";
  }

  return null;
}

interface HeaderCandidate {
  score: number;
  rowNumber: number;
  headers: DetectedAuctionHeaders;
}

function detectHeadersForRow(
  sheetName: string,
  row: ParsedAuctionWorkbookRow,
): HeaderCandidate {
  const detectedByField: Record<BatchAuctionCanonicalField, DetectedHeaderColumn[]> = {
    description: [],
    title: [],
    startingPrice: [],
    imageNames: [],
  };
  const allHeaders: DetectedHeaderColumn[] = [];

  row.cells.forEach((cell, index) => {
    const header = cellAsText(cell);
    if (!header) return;
    const column = { columnNumber: index + 1, header };
    allHeaders.push(column);
    const field = detectCanonicalField(header);
    if (field) detectedByField[field].push(column);
  });

  const duplicateFields = (
    ["description", "title", "startingPrice"] as const
  ).flatMap((field) =>
    detectedByField[field].length > 1
      ? [{ field, columns: detectedByField[field] }]
      : [],
  );
  const detectedColumnNumbers = new Set(
    Object.values(detectedByField)
      .flat()
      .map((column) => column.columnNumber),
  );
  const hasDescription =
    detectedByField.description.length > 0 || detectedByField.title.length > 0;
  const hasPrice = detectedByField.startingPrice.length > 0;
  const hasImages = detectedByField.imageNames.length > 0;
  const score =
    detectedByField.description.length * 4 +
    detectedByField.title.length * 3 +
    detectedByField.startingPrice.length * 5 +
    Math.min(detectedByField.imageNames.length, 8) * 4 +
    (hasDescription && hasPrice && hasImages ? 30 : 0) -
    duplicateFields.length * 4;

  return {
    score,
    rowNumber: row.rowNumber,
    headers: {
      sheetName,
      headerRowNumber: row.rowNumber,
      description: detectedByField.description[0] ?? null,
      title: detectedByField.title[0] ?? null,
      startingPrice: detectedByField.startingPrice[0] ?? null,
      imageNames: detectedByField.imageNames,
      duplicateFields,
      unusedHeaders: allHeaders.filter(
        (header) => !detectedColumnNumbers.has(header.columnNumber),
      ),
    },
  };
}

function countValidDataRows(
  rows: readonly ParsedAuctionWorkbookRow[],
  candidate: HeaderCandidate,
): number {
  const detected = candidate.headers;

  return rows.filter((row) => {
    if (row.rowNumber <= candidate.rowNumber) return false;

    const hasDescription = Boolean(
      cellAsText(valueAt(row, detected.description)) ||
        cellAsText(valueAt(row, detected.title)),
    );
    const hasStartingPrice =
      parseStartingPrice(valueAt(row, detected.startingPrice)) !== null;
    const hasImageName = detected.imageNames.some((column) =>
      Boolean(cellAsText(valueAt(row, column))),
    );

    return hasDescription && hasStartingPrice && hasImageName;
  }).length;
}

function rowsFromWorksheet(worksheet: {
  name: string;
  rowCount: number;
  actualRowCount: number;
  columnCount: number;
  actualColumnCount: number;
  eachRow: (
    options: { includeEmpty: boolean },
    callback: (
      row: {
        cellCount: number;
        actualCellCount: number;
        getCell: (columnNumber: number) => { value: unknown };
      },
      rowNumber: number,
    ) => void,
  ) => void;
}): ParsedAuctionWorkbookRow[] {
  const rows: ParsedAuctionWorkbookRow[] = [];
  const rawRowCount = Math.max(worksheet.rowCount, worksheet.actualRowCount);
  const rawColumnCount = Math.max(
    worksheet.columnCount,
    worksheet.actualColumnCount,
  );

  if (rawRowCount > MAX_RAW_WORKSHEET_ROWS) {
    throw new Error(
      `${worksheet.name} 시트는 최대 ${MAX_RAW_WORKSHEET_ROWS.toLocaleString("ko-KR")}행까지 읽을 수 있습니다.`,
    );
  }
  if (rawColumnCount > MAX_WORKSHEET_COLUMNS) {
    throw new Error(
      `${worksheet.name} 시트는 최대 ${MAX_WORKSHEET_COLUMNS.toLocaleString("ko-KR")}열까지 읽을 수 있습니다.`,
    );
  }

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber > MAX_RAW_WORKSHEET_ROWS) {
      throw new Error(
        `${worksheet.name} 시트는 최대 ${MAX_RAW_WORKSHEET_ROWS.toLocaleString("ko-KR")}행까지 읽을 수 있습니다.`,
      );
    }
    const columnCount = Math.max(
      worksheet.actualColumnCount,
      row.cellCount,
      row.actualCellCount,
    );
    if (columnCount > MAX_WORKSHEET_COLUMNS) {
      throw new Error(
        `${worksheet.name} 시트는 최대 ${MAX_WORKSHEET_COLUMNS.toLocaleString("ko-KR")}열까지 읽을 수 있습니다.`,
      );
    }
    const cells = Array.from({ length: columnCount }, (_, index) =>
      normalizeWorkbookCellValue(row.getCell(index + 1).value),
    );
    if (cells.some((cell) => cellAsText(cell) !== "")) {
      rows.push({ rowNumber, cells });
    }
  });

  return rows;
}

/** 브라우저에서 ExcelJS를 지연 로드해 가장 가능성 높은 시트와 헤더 행을 찾습니다. */
export async function parseAuctionWorkbook(
  file: File,
): Promise<ParsedAuctionWorkbook> {
  if (!/\.xlsx$/i.test(file.name)) {
    throw new Error("Excel 일괄 등록은 .xlsx 파일만 지원합니다.");
  }
  if (file.size <= 0 || file.size > MAX_WORKBOOK_BYTES) {
    throw new Error("Excel 파일 크기는 10MB 이하여야 합니다.");
  }

  const ExcelJSModule = await import("exceljs");
  // exceljs 4.x is CommonJS. Vite/Node interop exposes Workbook below default.
  const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
  const workbook = new ExcelJS.Workbook();
  const workbookBytes = await file.arrayBuffer();
  await workbook.xlsx.load(
    workbookBytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );

  const parsedSheets = workbook.worksheets
    .map((worksheet) => ({
      name: worksheet.name,
      rows: rowsFromWorksheet(worksheet),
    }))
    .filter((sheet) => sheet.rows.length > 0);

  if (parsedSheets.length === 0) {
    throw new Error("Excel 파일에서 데이터가 있는 시트를 찾지 못했습니다.");
  }

  let best:
    | {
        sheetName: string;
        rows: ParsedAuctionWorkbookRow[];
        candidate: HeaderCandidate;
        validDataRowCount: number;
      }
    | undefined;

  parsedSheets.forEach((sheet) => {
    sheet.rows.slice(0, HEADER_SCAN_LIMIT).forEach((row) => {
      const candidate = detectHeadersForRow(sheet.name, row);
      const validDataRowCount = countValidDataRows(sheet.rows, candidate);
      if (
        !best ||
        candidate.score > best.candidate.score ||
        (candidate.score === best.candidate.score &&
          validDataRowCount > best.validDataRowCount)
      ) {
        best = {
          sheetName: sheet.name,
          rows: sheet.rows,
          candidate,
          validDataRowCount,
        };
      }
    });
  });

  if (!best) {
    throw new Error("Excel 헤더 행을 확인하지 못했습니다.");
  }

  const selectedSheet = best;
  const dataRows = selectedSheet.rows
    .filter((row) => row.rowNumber > selectedSheet.candidate.rowNumber)
    .slice(0, MAX_IMPORT_ROWS + 1);
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new Error(`한 번에 최대 ${MAX_IMPORT_ROWS.toLocaleString("ko-KR")}개 상품을 등록할 수 있습니다.`);
  }

  return {
    fileName: file.name,
    sheetName: selectedSheet.sheetName,
    detectedHeaders: selectedSheet.candidate.headers,
    rows: dataRows,
  };
}

export function normalizeImageReference(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+|\/+$/g, "")
    .toLocaleLowerCase("en-US");
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function fileStem(path: string): string {
  const name = basename(path);
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? name.slice(0, dotIndex) : name;
}

function fileRelativePath(file: File): string {
  return file.webkitRelativePath || file.name;
}

function fileIdentity(file: File): string {
  return `${normalizeImageReference(fileRelativePath(file))}:${file.size}:${file.lastModified}`;
}

function addToFileIndex(map: Map<string, File[]>, key: string, file: File) {
  if (!key) return;
  const current = map.get(key) ?? [];
  if (!current.some((candidate) => fileIdentity(candidate) === fileIdentity(file))) {
    current.push(file);
    map.set(key, current);
  }
}

interface ImageFileIndex {
  relativePaths: Map<string, File[]>;
  basenames: Map<string, File[]>;
  stems: Map<string, File[]>;
  usableFiles: File[];
  issues: BatchAuctionIssue[];
}

function buildImageFileIndex(files: readonly File[]): ImageFileIndex {
  const relativePaths = new Map<string, File[]>();
  const basenames = new Map<string, File[]>();
  const stems = new Map<string, File[]>();
  const usableFiles: File[] = [];
  const issues: BatchAuctionIssue[] = [];
  const selectedIdentities = new Set<string>();

  files.forEach((file) => {
    const identity = fileIdentity(file);
    if (selectedIdentities.has(identity)) {
      issues.push({
        code: "duplicate_selected_file",
        message: `같은 사진이 중복 선택되었습니다: ${fileRelativePath(file)}`,
        severity: "error",
      });
      return;
    }
    selectedIdentities.add(identity);

    if (!isSupportedProductImageMimeType(file.type)) {
      issues.push({
        code: "unsupported_image",
        message: `지원하지 않는 파일은 매칭에서 제외했습니다: ${fileRelativePath(file)}`,
        severity: "warning",
      });
      return;
    }
    if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
      issues.push({
        code: "invalid_image_size",
        message: `10MB를 초과하거나 비어 있는 사진은 제외했습니다: ${fileRelativePath(file)}`,
        severity: "warning",
      });
      return;
    }

    usableFiles.push(file);
    const fullRelativePath = normalizeImageReference(fileRelativePath(file));
    const segments = fullRelativePath.split("/");
    const relativeWithoutSelectedRoot =
      segments.length > 1 ? segments.slice(1).join("/") : fullRelativePath;
    const normalizedBasename = basename(fullRelativePath);

    addToFileIndex(relativePaths, fullRelativePath, file);
    addToFileIndex(relativePaths, relativeWithoutSelectedRoot, file);
    addToFileIndex(basenames, normalizedBasename, file);
    addToFileIndex(stems, fileStem(normalizedBasename), file);
  });

  return { relativePaths, basenames, stems, usableFiles, issues };
}

function uniqueCandidates(files: readonly File[]): File[] {
  const byIdentity = new Map(files.map((file) => [fileIdentity(file), file]));
  return [...byIdentity.values()];
}

function matchImageReference(
  rawReference: string,
  index: ImageFileIndex,
):
  | { match: BatchAuctionImageMatch; issue: null }
  | { match: null; issue: BatchAuctionIssue } {
  const reference = normalizeImageReference(rawReference);
  const attempts: Array<{ strategy: ImageMatchStrategy; files: File[] }> = [];

  if (reference.includes("/")) {
    attempts.push({
      strategy: "relative-path",
      files: uniqueCandidates(index.relativePaths.get(reference) ?? []),
    });
  }

  attempts.push(
    {
      strategy: "basename",
      files: uniqueCandidates(index.basenames.get(basename(reference)) ?? []),
    },
    {
      strategy: "unique-stem",
      files: uniqueCandidates(index.stems.get(fileStem(reference)) ?? []),
    },
  );

  for (const attempt of attempts) {
    if (attempt.files.length === 1) {
      return {
        match: {
          reference: rawReference,
          file: attempt.files[0],
          strategy: attempt.strategy,
        },
        issue: null,
      };
    }
    if (attempt.files.length > 1) {
      return {
        match: null,
        issue: {
          code: "ambiguous_image",
          message: `사진명이 여러 파일과 일치합니다: ${rawReference}`,
          severity: "error",
        },
      };
    }
  }

  return {
    match: null,
    issue: {
      code: "unmatched_image",
      message: `선택한 폴더에서 사진을 찾지 못했습니다: ${rawReference}`,
      severity: "error",
    },
  };
}

function hasExactImageCandidate(
  rawReference: string,
  index: ImageFileIndex,
): boolean {
  const reference = normalizeImageReference(rawReference);
  if (!reference) return false;

  return (
    uniqueCandidates(index.relativePaths.get(reference) ?? []).length > 0 ||
    uniqueCandidates(index.basenames.get(basename(reference)) ?? []).length > 0
  );
}

function splitImageNames(
  value: ParsedWorkbookCell | undefined,
  index: ImageFileIndex,
): string[] {
  const text = cellAsText(value);
  if (!text) return [];

  const primaryParts = text.split(/\r?\n|[;|]/);
  const parts =
    primaryParts.length === 1 &&
    text.includes(",") &&
    !hasExactImageCandidate(text, index)
      ? text.split(",")
      : primaryParts;
  return parts.map((part) => part.trim()).filter(Boolean);
}

function parseStartingPrice(value: ParsedWorkbookCell | undefined): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 && value <= 1_000_000_000
      ? value
      : null;
  }

  const normalized = cellAsText(value)
    .normalize("NFKC")
    .replace(/[₩원,\s]/g, "");
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 1_000_000_000
    ? parsed
    : null;
}

function valueAt(
  row: ParsedAuctionWorkbookRow,
  column: DetectedHeaderColumn | null,
): ParsedWorkbookCell | undefined {
  return column ? row.cells[column.columnNumber - 1] : undefined;
}

function hasErrors(issues: readonly BatchAuctionIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

function validateDetectedHeaders(
  detected: DetectedAuctionHeaders,
): BatchAuctionIssue[] {
  const issues: BatchAuctionIssue[] = [];
  if (!detected.description && !detected.title) {
    issues.push({
      code: "missing_description_header",
      message: "상품 설명 또는 상품명 열을 자동으로 찾지 못했습니다.",
      severity: "error",
    });
  }
  if (!detected.startingPrice) {
    issues.push({
      code: "missing_starting_price_header",
      message: "시작가 열을 자동으로 찾지 못했습니다.",
      severity: "error",
    });
  }
  if (detected.imageNames.length === 0) {
    issues.push({
      code: "missing_image_header",
      message: "이미지명 또는 사진명 열을 자동으로 찾지 못했습니다.",
      severity: "error",
    });
  }
  detected.duplicateFields.forEach(({ field, columns }) => {
    issues.push({
      code: `duplicate_${field}_header`,
      message: `${columns.map((column) => column.header).join(", ")} 열이 같은 항목으로 중복 탐지되었습니다.`,
      severity: "error",
    });
  });
  return issues;
}

/** Excel 행과 사용자가 선택한 사진을 검증하고, 부작용 없는 등록 초안을 만듭니다. */
export function buildBatchAuctionPreview(
  workbook: ParsedAuctionWorkbook,
  imageFiles: readonly File[],
  options: BatchAuctionDraftOptions,
): BatchAuctionPreview {
  const imageIndex = buildImageFileIndex(imageFiles);
  const globalIssues = [
    ...validateDetectedHeaders(workbook.detectedHeaders),
    ...imageIndex.issues,
  ];
  const publishAt = new Date(options.publishAt);
  if (Number.isNaN(publishAt.getTime())) {
    globalIssues.push({
      code: "invalid_publish_at",
      message: "공개 시간이 올바르지 않습니다.",
      severity: "error",
    });
  }
  if (
    !Number.isInteger(options.bidIncrement) ||
    options.bidIncrement <= 0 ||
    options.bidIncrement > 100_000_000
  ) {
    globalIssues.push({
      code: "invalid_bid_increment",
      message: "입찰 단위는 1원 이상 1억원 이하의 정수여야 합니다.",
      severity: "error",
    });
  }
  if (imageFiles.length === 0) {
    globalIssues.push({
      code: "missing_image_files",
      message: "상품 사진 폴더 또는 여러 사진 파일을 선택해 주세요.",
      severity: "error",
    });
  }

  const rows: BatchAuctionPreviewRow[] = workbook.rows.map((row) => {
    const issues: BatchAuctionIssue[] = [];
    const detected = workbook.detectedHeaders;
    const descriptionCell = cellAsText(valueAt(row, detected.description));
    const titleCell = cellAsText(valueAt(row, detected.title));
    const description = descriptionCell || titleCell;
    const title =
      titleCell ||
      description
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ||
      "";
    const startingPrice = parseStartingPrice(
      valueAt(row, detected.startingPrice),
    );
    const imageNames = detected.imageNames.flatMap((column) =>
      splitImageNames(valueAt(row, column), imageIndex),
    );

    if (!description) {
      issues.push({
        code: "missing_description",
        message: "상품 설명 또는 상품명이 비어 있습니다.",
        severity: "error",
      });
    }
    if (startingPrice === null) {
      issues.push({
        code: "invalid_starting_price",
        message: "시작가는 1원 이상 10억원 이하의 정수여야 합니다.",
        severity: "error",
      });
    }
    if (imageNames.length === 0) {
      issues.push({
        code: "missing_image_name",
        message: "이미지명이 비어 있습니다.",
        severity: "error",
      });
    }

    const normalizedNames = imageNames.map(normalizeImageReference);
    const seenNames = new Set<string>();
    normalizedNames.forEach((name, index) => {
      if (seenNames.has(name)) {
        issues.push({
          code: "duplicate_image_reference",
          message: `같은 이미지명이 한 상품에 중복되었습니다: ${imageNames[index]}`,
          severity: "error",
        });
      }
      seenNames.add(name);
    });

    const imageMatches: BatchAuctionImageMatch[] = [];
    imageNames.forEach((imageName) => {
      const result = matchImageReference(imageName, imageIndex);
      if (result.match) imageMatches.push(result.match);
      if (result.issue) issues.push(result.issue);
    });

    return {
      rowNumber: row.rowNumber,
      title,
      description,
      startingPrice,
      imageNames,
      imageMatches,
      issues,
      draft: null,
    };
  });

  if (rows.length === 0) {
    globalIssues.push({
      code: "missing_product_rows",
      message: "헤더 아래에서 등록할 상품 행을 찾지 못했습니다.",
      severity: "error",
    });
  }

  const fileUsage = new Map<string, BatchAuctionPreviewRow>();
  rows.forEach((row) => {
    row.imageMatches.forEach((match) => {
      const identity = fileIdentity(match.file);
      const previousRow = fileUsage.get(identity);
      if (previousRow && previousRow.rowNumber !== row.rowNumber) {
        const message = `같은 사진이 ${previousRow.rowNumber}행과 ${row.rowNumber}행에 중복 매칭되었습니다: ${fileRelativePath(match.file)}`;
        if (!previousRow.issues.some((issue) => issue.message === message)) {
          previousRow.issues.push({
            code: "image_reused_across_products",
            message,
            severity: "error",
          });
        }
        row.issues.push({
          code: "image_reused_across_products",
          message,
          severity: "error",
        });
      } else {
        fileUsage.set(identity, row);
      }
    });
  });

  const globalHasErrors = hasErrors(globalIssues);
  rows.forEach((row) => {
    if (
      globalHasErrors ||
      hasErrors(row.issues) ||
      row.startingPrice === null ||
      !row.description ||
      !row.title
    ) {
      row.draft = null;
      return;
    }

    row.draft = {
      title: row.title,
      description: row.description,
      startingPrice: row.startingPrice,
      bidIncrement: options.bidIncrement,
      imageFiles: row.imageMatches.map((match) => match.file),
      status: options.status,
      publish_at: publishAt.toISOString(),
    };
  });

  const usedFileIds = new Set(
    rows.flatMap((row) =>
      row.imageMatches.map((match) => fileIdentity(match.file)),
    ),
  );
  const unusedImageFiles = imageIndex.usableFiles.filter(
    (file) => !usedFileIds.has(fileIdentity(file)),
  );
  if (unusedImageFiles.length > 0) {
    globalIssues.push({
      code: "unused_image_files",
      message: `${unusedImageFiles.length.toLocaleString("ko-KR")}개 사진은 Excel의 이미지명과 연결되지 않았습니다.`,
      severity: "warning",
    });
  }

  const canSubmit =
    rows.length > 0 &&
    !hasErrors(globalIssues) &&
    rows.every((row) => row.draft !== null && !hasErrors(row.issues));

  return {
    rows,
    globalIssues,
    unusedImageFiles,
    drafts: canSubmit
      ? rows.flatMap((row) => (row.draft ? [row.draft] : []))
      : [],
    canSubmit,
  };
}
