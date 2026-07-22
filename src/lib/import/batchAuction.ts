import type { NewAuctionDraft } from "@/src/core/contracts/productDraft";
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
  size: DetectedHeaderColumn | null;
  conditionScore: DetectedHeaderColumn | null;
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
  size: string;
  condition: BatchAuctionCondition | null;
  /** 기존 X열 원문입니다. 공개 본문에는 넣지 않고 진단/호환용으로만 보존합니다. */
  sourceDescription: string;
  description: string;
  startingPrice: number | null;
  imageNames: string[];
  imageMatches: BatchAuctionImageMatch[];
  issues: BatchAuctionIssue[];
  draft: NewAuctionDraft | null;
}

export type BatchAuctionCondition = "새상품" | "상태 좋음" | "사용감 있음";

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
const MAX_PRODUCT_IMAGES = 12;
export const FIRST_PRODUCT_ROW = 6;
const FIXED_TEMPLATE_COLUMNS = {
  title: 1,
  size: 4,
  conditionScore: 23,
  description: 24,
  startingPrice: 25,
  imageNames: 34,
} as const;

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

interface HeaderCandidate {
  score: number;
  rowNumber: number;
  headers: DetectedAuctionHeaders;
}

interface FixedTemplateCandidate {
  candidate: HeaderCandidate;
  evidenceScore: number;
  validDataRowCount: number;
}

function fixedTemplateColumn(
  headerRow: ParsedAuctionWorkbookRow | undefined,
  columnNumber: number,
  fallbackHeader: string,
): DetectedHeaderColumn {
  return {
    columnNumber,
    header: cellAsText(headerRow?.cells[columnNumber - 1]) || fallbackHeader,
  };
}

function detectFixedTemplateForSheet(
  sheetName: string,
  rows: readonly ParsedAuctionWorkbookRow[],
): FixedTemplateCandidate | null {
  let evidenceScore = 0;
  let validDataRowCount = 0;

  rows.forEach((row) => {
    if (row.rowNumber < FIRST_PRODUCT_ROW) return;

    const hasTitle = Boolean(
      cellAsText(row.cells[FIXED_TEMPLATE_COLUMNS.title - 1]),
    );
    const hasSize = Boolean(
      normalizeBatchAuctionSize(
        row.cells[FIXED_TEMPLATE_COLUMNS.size - 1],
      ),
    );
    const hasValidConditionScore =
      parseBatchAuctionConditionScore(
        row.cells[FIXED_TEMPLATE_COLUMNS.conditionScore - 1],
      ) !== null;
    const hasConditionValue = Boolean(
      cellAsText(row.cells[FIXED_TEMPLATE_COLUMNS.conditionScore - 1]),
    );
    const hasDescription = Boolean(
      cellAsText(row.cells[FIXED_TEMPLATE_COLUMNS.description - 1]),
    );
    const hasStartingPrice =
      parseStartingPrice(
        row.cells[FIXED_TEMPLATE_COLUMNS.startingPrice - 1],
      ) !== null;
    const hasStartingPriceValue = Boolean(
      cellAsText(row.cells[FIXED_TEMPLATE_COLUMNS.startingPrice - 1]),
    );
    const hasImageName = Boolean(
      cellAsText(row.cells[FIXED_TEMPLATE_COLUMNS.imageNames - 1]),
    );
    const populatedFixedColumns = [
      hasTitle,
      hasSize,
      hasConditionValue,
      hasDescription,
      hasStartingPriceValue,
      hasImageName,
    ].filter(Boolean).length;
    const hasFixedTemplateEvidence =
      (hasStartingPrice && (hasTitle || hasDescription || hasImageName)) ||
      (hasDescription && hasImageName) ||
      ((hasTitle || hasDescription) && populatedFixedColumns >= 3);

    if (!hasFixedTemplateEvidence) return;

    evidenceScore +=
      (hasTitle ? 3 : 0) +
      (hasSize ? 6 : 0) +
      (hasValidConditionScore ? 6 : 0) +
      (hasDescription ? 4 : 0) +
      (hasStartingPrice ? 5 : 0) +
      (hasImageName ? 4 : 0);
    if (
      hasTitle &&
      hasSize &&
      hasValidConditionScore &&
      hasStartingPrice &&
      hasImageName
    ) {
      validDataRowCount += 1;
      evidenceScore += 30;
    }
  });

  if (evidenceScore === 0) return null;

  const headerRow = rows.find((row) => row.rowNumber === 1);
  const fixedColumnNumbers = new Set<number>(
    Object.values(FIXED_TEMPLATE_COLUMNS),
  );
  const unusedHeaders = (headerRow?.cells ?? []).flatMap((cell, index) => {
    const header = cellAsText(cell);
    const columnNumber = index + 1;
    return header && !fixedColumnNumbers.has(columnNumber)
      ? [{ columnNumber, header }]
      : [];
  });
  const headerRowNumber = headerRow?.rowNumber ?? 1;

  return {
    evidenceScore,
    validDataRowCount,
    candidate: {
      score: evidenceScore,
      rowNumber: headerRowNumber,
      headers: {
        sheetName,
        headerRowNumber,
        title: fixedTemplateColumn(
          headerRow,
          FIXED_TEMPLATE_COLUMNS.title,
          "A열 상품명",
        ),
        size: fixedTemplateColumn(
          headerRow,
          FIXED_TEMPLATE_COLUMNS.size,
          "D열 사이즈",
        ),
        conditionScore: fixedTemplateColumn(
          headerRow,
          FIXED_TEMPLATE_COLUMNS.conditionScore,
          "W열 상태점수",
        ),
        description: fixedTemplateColumn(
          headerRow,
          FIXED_TEMPLATE_COLUMNS.description,
          "X열 상품 설명",
        ),
        startingPrice: fixedTemplateColumn(
          headerRow,
          FIXED_TEMPLATE_COLUMNS.startingPrice,
          "Y열 시작가",
        ),
        imageNames: [
          fixedTemplateColumn(
            headerRow,
            FIXED_TEMPLATE_COLUMNS.imageNames,
            "AH열 이미지명",
          ),
        ],
        duplicateFields: [],
        unusedHeaders,
      },
    },
  };
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

/** 브라우저에서 ExcelJS를 지연 로드해 기존 고정 열 양식의 상품 시트를 찾습니다. */
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

  let fixedTemplateBest:
    | {
        sheetName: string;
        rows: ParsedAuctionWorkbookRow[];
        candidate: HeaderCandidate;
        evidenceScore: number;
        validDataRowCount: number;
      }
    | undefined;

  parsedSheets.forEach((sheet) => {
    const fixedTemplate = detectFixedTemplateForSheet(sheet.name, sheet.rows);
    if (
      fixedTemplate &&
      (!fixedTemplateBest ||
        fixedTemplate.validDataRowCount >
          fixedTemplateBest.validDataRowCount ||
        (fixedTemplate.validDataRowCount ===
          fixedTemplateBest.validDataRowCount &&
          fixedTemplate.evidenceScore > fixedTemplateBest.evidenceScore))
    ) {
      fixedTemplateBest = {
        sheetName: sheet.name,
        rows: sheet.rows,
        candidate: fixedTemplate.candidate,
        evidenceScore: fixedTemplate.evidenceScore,
        validDataRowCount: fixedTemplate.validDataRowCount,
      };
    }
  });

  const selectedSheet = fixedTemplateBest;
  if (!selectedSheet) {
    throw new Error("기존 Excel 고정 양식(A/D/W/X/Y/AH 열, 6행 시작)을 확인하지 못했습니다.");
  }

  const dataRows = selectedSheet.rows
    .filter(
      (row) =>
        row.rowNumber >= FIRST_PRODUCT_ROW &&
        row.rowNumber > selectedSheet.candidate.rowNumber,
    )
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

  return text
    .split(/\r?\n|[;|]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      if (!part.includes(",") || hasExactImageCandidate(part, index)) {
        return [part];
      }

      return part
        .split(",")
        .map((nestedPart) => nestedPart.trim())
        .filter(Boolean);
    });
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

/** A열 맨 앞의 사이즈 토큰 하나만 제거하고 실제 상품명을 반환합니다. */
export function normalizeBatchAuctionProductName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/^\s*\[[^\]\r\n]*\]\s*/u, "")
    .trim();
}

/** D열의 줄바꿈과 연속 공백만 접어 추천 사이즈 문구 전체를 한 줄로 보존합니다. */
export function normalizeBatchAuctionSize(
  value: ParsedWorkbookCell | undefined,
): string {
  return cellAsText(value)
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

type BatchAuctionConditionScore = 1 | 2 | 3 | 4 | 5;

function parseBatchAuctionConditionScore(
  value: ParsedWorkbookCell | undefined,
): BatchAuctionConditionScore | null {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 5
  ) {
    return value as BatchAuctionConditionScore;
  }

  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim();
  return /^[1-5]$/.test(normalized)
    ? (Number(normalized) as BatchAuctionConditionScore)
    : null;
}

/** W열 상태점수를 공개용 한국어 상태로 변환합니다. 3과 5는 의도적으로 숨깁니다. */
export function mapBatchAuctionConditionScore(
  value: ParsedWorkbookCell | undefined,
): BatchAuctionCondition | null {
  const score = parseBatchAuctionConditionScore(value);

  if (score === 1) return "새상품";
  if (score === 2) return "상태 좋음";
  if (score === 4) return "사용감 있음";
  return null;
}

function buildFixedTemplateDescription(
  title: string,
  size: string,
  condition: BatchAuctionCondition | null,
): string {
  if (!title) return "";

  return [
    `Name: ${title}`,
    `Size : ${size}`,
    ...(condition ? [`상품상태: ${condition}`] : []),
  ].join("\n");
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
    const isFixedTemplate = Boolean(
      detected.title?.columnNumber === FIXED_TEMPLATE_COLUMNS.title &&
        detected.size?.columnNumber === FIXED_TEMPLATE_COLUMNS.size &&
        detected.conditionScore?.columnNumber ===
          FIXED_TEMPLATE_COLUMNS.conditionScore,
    );
    const fallbackDescription = descriptionCell || titleCell;
    const rawTitle =
      titleCell ||
      fallbackDescription
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ||
      "";
    const title = isFixedTemplate
      ? normalizeBatchAuctionProductName(rawTitle)
      : rawTitle;
    const size = isFixedTemplate
      ? normalizeBatchAuctionSize(valueAt(row, detected.size))
      : "";
    const conditionScore = isFixedTemplate
      ? parseBatchAuctionConditionScore(valueAt(row, detected.conditionScore))
      : null;
    const condition = isFixedTemplate
      ? mapBatchAuctionConditionScore(valueAt(row, detected.conditionScore))
      : null;
    const description = isFixedTemplate
      ? buildFixedTemplateDescription(title, size, condition)
      : fallbackDescription;
    const startingPrice = parseStartingPrice(
      valueAt(row, detected.startingPrice),
    );
    const imageNames = detected.imageNames.flatMap((column) =>
      splitImageNames(valueAt(row, column), imageIndex),
    );

    if (isFixedTemplate && !title) {
      issues.push({
        code: "missing_title",
        message: "A열 상품명이 비어 있거나 사이즈 토큰만 입력되어 있습니다.",
        severity: "error",
      });
    } else if (!description) {
      issues.push({
        code: "missing_description",
        message: "상품 설명 또는 상품명이 비어 있습니다.",
        severity: "error",
      });
    }
    if (isFixedTemplate && !size) {
      issues.push({
        code: "missing_size",
        message: "D열 사이즈 및 추천 사이즈가 비어 있습니다.",
        severity: "error",
      });
    }
    if (isFixedTemplate && conditionScore === null) {
      issues.push({
        code: "invalid_condition_score",
        message: "W열 상태점수는 숫자 또는 문자열 1, 2, 3, 4, 5 중 하나여야 합니다.",
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
    } else if (imageNames.length > MAX_PRODUCT_IMAGES) {
      issues.push({
        code: "too_many_product_images",
        message: `상품 한 개에는 사진을 최대 ${MAX_PRODUCT_IMAGES}장까지 등록할 수 있습니다.`,
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
      size,
      condition,
      sourceDescription: descriptionCell,
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
      saleType: "auction",
      fixedPrice: null,
      startingPrice: row.startingPrice,
      bidIncrement: options.bidIncrement,
      imageFiles: row.imageMatches.map((match) => match.file),
      status: "pending",
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
