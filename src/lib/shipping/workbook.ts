import type { ShippingWork } from "@/src/lib/supabase/operations";

import {
  SHIPPING_EXPORT_HEADERS,
  buildShippingExportRow,
  detectTrackingHeaderRow,
  matchTrackingImportRows,
  normalizeShippingAddressSnapshot,
  parseTrackingImportRows,
  validateTrackingWorkbookFile,
  type SpreadsheetRow,
  type TrackingImportParseResult,
  type TrackingMatchResult,
} from "./excel";

const WORKBOOK_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_WORKSHEET_COLUMNS = 64;

export interface ParsedTrackingWorkbook {
  fileName: string;
  sheetName: string;
  parsed: TrackingImportParseResult;
  matches: TrackingMatchResult;
}

export interface ShippingWorkbookOptions {
  paymentTerm: "선불" | "착불" | "신용";
}

function exportDateKey(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

function dispatchReference(item: ShippingWork): string {
  return `ORD-${exportDateKey(item.requestedAt)}-${item.requestId.toUpperCase()}`;
}

async function createWorkbook() {
  const ExcelJSModule = await import("exceljs");
  // exceljs 4.x is CommonJS. Both Vite and Node expose Workbook below default.
  const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
  return new ExcelJS.Workbook();
}

function assertExportable(items: readonly ShippingWork[]) {
  const incomplete = items.filter((item) => {
    const address = normalizeShippingAddressSnapshot(item.addressSnapshot);
    return !address.recipientName || !address.phone || !address.postalCode || !address.address;
  });
  if (incomplete.length > 0) {
    const examples = incomplete
      .slice(0, 3)
      .map((item) => dispatchReference(item))
      .join(", ");
    throw new Error(
      `필수 배송 정보(받는 분·연락처·5자리 우편번호·주소)가 누락된 ${incomplete.length.toLocaleString("ko-KR")}건은 내보낼 수 없습니다.${examples ? ` 확인: ${examples}` : ""}`,
    );
  }
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function downloadShippingRequestsWorkbook(
  items: readonly ShippingWork[],
  options: ShippingWorkbookOptions = { paymentTerm: "선불" },
): Promise<void> {
  if (items.length === 0) throw new Error("Excel로 내보낼 배송 신청을 선택해 주세요.");
  assertExportable(items);

  const workbook = await createWorkbook();
  workbook.creator = "NINETY-NINE VINTAGE";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("택배 발송 신청", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  worksheet.addRow([...SHIPPING_EXPORT_HEADERS]);

  items.forEach((item) => {
    worksheet.addRow(
      buildShippingExportRow({
        requestId: item.requestId,
        addressSnapshot: item.addressSnapshot,
        dispatchReference: dispatchReference(item),
        paymentTerm: options.paymentTerm,
      }),
    );
  });

  worksheet.columns = [
    { width: 18 },
    { width: 4 },
    { width: 4 },
    { width: 19 },
    { width: 16 },
    { width: 52 },
    { width: 9 },
    { width: 13 },
    { width: 4 },
    { width: 13 },
    { width: 58 },
    { width: 34 },
    { width: 20 },
    { width: 20 },
    { width: 20 },
    { width: 20 },
  ];
  worksheet.autoFilter = { from: "A1", to: "P1" };
  // Preserve phone, postcode and dispatch references as text when the workbook
  // is opened and saved again in Excel.
  worksheet.getColumn(4).numFmt = "@";
  worksheet.getColumn(5).numFmt = "@";
  worksheet.getColumn(11).numFmt = "@";
  const header = worksheet.getRow(1);
  header.height = 26;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.alignment = { vertical: "middle", horizontal: "center" };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF6A5145" },
  };
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: "middle", wrapText: true };
    row.height = 24;
  });

  const bytes = await workbook.xlsx.writeBuffer();
  const blob = new Blob([bytes as BlobPart], { type: WORKBOOK_MIME });
  const today = exportDateKey(new Date().toISOString());
  downloadBlob(blob, `택배발송신청_${today}_${items.length}건.xlsx`);
}

function worksheetRows(worksheet: {
  eachRow: (
    options: { includeEmpty: boolean },
    callback: (row: { cellCount: number; getCell: (index: number) => { value: unknown } }, rowNumber: number) => void,
  ) => void;
}): SpreadsheetRow[] {
  const rows: SpreadsheetRow[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const columnCount = Math.min(row.cellCount, MAX_WORKSHEET_COLUMNS);
    rows.push({
      rowNumber,
      cells: Array.from(
        { length: columnCount },
        (_, columnIndex) => row.getCell(columnIndex + 1).value,
      ),
    });
  });
  return rows;
}

export async function parseTrackingWorkbook(
  file: File,
  candidates: readonly ShippingWork[],
): Promise<ParsedTrackingWorkbook> {
  validateTrackingWorkbookFile(file);

  const workbook = await createWorkbook();
  const bytes = await file.arrayBuffer();
  await workbook.xlsx.load(
    bytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );

  for (const worksheet of workbook.worksheets) {
    const rows = worksheetRows(worksheet);
    const detected = detectTrackingHeaderRow(rows);
    if (!detected) continue;
    const parsed = parseTrackingImportRows(rows, detected);
    const matches = matchTrackingImportRows(parsed.rows, candidates);
    return {
      fileName: file.name,
      sheetName: worksheet.name,
      parsed,
      matches,
    };
  }

  throw new Error(
    "송장 양식의 헤더를 찾지 못했습니다. 운송장번호·받는분·전화번호 열을 확인해 주세요.",
  );
}
