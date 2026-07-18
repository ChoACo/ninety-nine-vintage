/**
 * Pure helpers shared by the operator shipping Excel UI.
 *
 * Excel files contain customer contact details, so parsing and matching are kept
 * in the browser. This module deliberately has no Supabase or ExcelJS dependency.
 */

export const SHIPPING_EXPORT_HEADERS = [
  "받으시는 분",
  "",
  "",
  "받는분핸드폰",
  "받는분우편번호",
  "받는분총주소",
  "수량",
  "품목명",
  "",
  "지불조건",
  "출고번호",
  "특기사항",
  "메모1",
  "메모2",
  "메모3",
  "메모4",
] as const;

export const TRACKING_IMPORT_HEADERS = [
  "순번",
  "운송장번호",
  "받는분",
  "받는분 전화번호",
  "받는분 담당자",
  "받는분 휴대폰번호",
  "받는분 우편번호",
  "받는분 주소",
  "수량",
  "보내는사람",
  "품목명",
] as const;

const TRACKING_HEADER_SCAN_LIMIT = 10;
export const MAX_TRACKING_WORKBOOK_BYTES = 10 * 1024 * 1024;
export const MAX_TRACKING_IMPORT_ROWS = 1_000;

export interface SpreadsheetRow {
  rowNumber: number;
  cells: readonly unknown[];
}

export function validateTrackingWorkbookFile(file: Pick<File, "name" | "size">): void {
  if (!/\.xlsx$/i.test(file.name)) {
    throw new Error("송장 일괄 등록은 .xlsx 파일만 지원합니다.");
  }
  if (file.size <= 0 || file.size > MAX_TRACKING_WORKBOOK_BYTES) {
    throw new Error("송장 Excel 파일 크기는 10MB 이하여야 합니다.");
  }
}

export interface NormalizedShippingAddress {
  recipientName: string;
  phone: string;
  postalCode: string;
  address: string;
  note: string;
  paymentTerm: string;
}

export interface ShippingExportInput {
  requestId: string;
  addressSnapshot: unknown;
  paymentTerm?: string;
  dispatchReference?: string;
  note?: string;
  memos?: readonly string[];
}

export type ShippingExportRow = [
  recipientName: string,
  blankB: "",
  blankC: "",
  phone: string,
  postalCode: string,
  address: string,
  quantity: 1,
  itemName: "의류",
  blankI: "",
  paymentTerm: string,
  dispatchReference: string,
  note: string,
  memo1: string,
  memo2: string,
  memo3: string,
  memo4: string,
];

export type TrackingImportField =
  | "sequence"
  | "trackingNumber"
  | "recipientName"
  | "phone"
  | "managerName"
  | "mobile"
  | "postalCode"
  | "address"
  | "quantity"
  | "senderName"
  | "itemName";

export interface DetectedTrackingHeaders {
  headerRowNumber: number;
  columns: Record<TrackingImportField, number | null>;
}

export interface TrackingImportRow {
  rowNumber: number;
  sequence: string;
  trackingNumber: string;
  recipientName: string;
  phone: string;
  managerName: string;
  mobile: string;
  postalCode: string;
  address: string;
  quantity: string;
  senderName: string;
  itemName: string;
}

export interface TrackingImportParseResult {
  rows: TrackingImportRow[];
  skippedRows: Array<{ rowNumber: number; reason: string }>;
}

export interface ShippingMatchCandidate {
  requestId: string;
  addressSnapshot: unknown;
}

export interface MatchedTrackingImport {
  row: TrackingImportRow;
  requestId: string;
  trackingNumber: string;
}

export interface AmbiguousTrackingImport {
  row: TrackingImportRow;
  candidateRequestIds: string[];
  reason: string;
}

export interface UnmatchedTrackingImport {
  row: TrackingImportRow;
  reason: string;
}

export interface TrackingMatchResult {
  matched: MatchedTrackingImport[];
  ambiguous: AmbiguousTrackingImport[];
  unmatched: UnmatchedTrackingImport[];
}

function recordValue(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return "";
}

export function spreadsheetCellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" && !Number.isSafeInteger(value)) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (typeof value !== "object" || Array.isArray(value)) return "";

  const record = value as Record<string, unknown>;
  if ("result" in record && record.result !== undefined) {
    return spreadsheetCellText(record.result);
  }
  if (typeof record.text === "string") return record.text.trim();
  if (Array.isArray(record.richText)) {
    return record.richText
      .map((part) =>
        part && typeof part === "object" && "text" in part
          ? String((part as { text?: unknown }).text ?? "")
          : "",
      )
      .join("")
      .trim();
  }
  return "";
}

export function normalizePhoneForMatch(value: string): string {
  let digits = value.normalize("NFKC").replace(/\D/g, "");
  if (digits.startsWith("82") && digits.length >= 11) digits = `0${digits.slice(2)}`;
  // Excel can coerce 01012345678 into 1012345678 when the cell is numeric.
  if (digits.length === 10 && digits.startsWith("10")) digits = `0${digits}`;
  return digits;
}

export function formatKoreanPhone(value: string): string {
  const digits = normalizePhoneForMatch(value);
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.startsWith("02") && digits.length === 10) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.startsWith("02") && digits.length === 9) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
  }
  return value.normalize("NFKC").trim();
}

export function normalizePostalCode(value: string): string {
  const digits = value.normalize("NFKC").replace(/\D/g, "");
  // Excel can coerce a text postcode such as 06234 into the number 6234.
  if (digits.length === 4) return digits.padStart(5, "0");
  return digits.length === 5 ? digits : "";
}

function splitLeadingPostalCode(address: string): { postalCode: string; address: string } {
  const normalized = address.normalize("NFKC").trim();
  const match = normalized.match(/^\s*(?:\[(\d{5})\]|\((\d{5})\)|(\d{5})(?=\s|,|-))\s*[-,]?\s*/);
  if (!match) return { postalCode: "", address: normalized };
  return {
    postalCode: match[1] ?? match[2] ?? match[3] ?? "",
    address: normalized.slice(match[0].length).trim(),
  };
}

export function normalizeShippingAddressSnapshot(snapshot: unknown): NormalizedShippingAddress {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { recipientName: "", phone: "", postalCode: "", address: "", note: "", paymentTerm: "" };
  }

  const record = snapshot as Record<string, unknown>;
  const rawAddress = recordValue(record, [
    "address",
    "fullAddress",
    "full_address",
    "addressLine",
    "address_line",
  ]);
  const split = splitLeadingPostalCode(rawAddress);
  const explicitPostalCode = normalizePostalCode(
    recordValue(record, ["postalCode", "postal_code", "postcode", "zipCode", "zip_code"]),
  );

  return {
    recipientName: recordValue(record, ["recipientName", "recipient_name", "recipient", "name"]),
    phone: formatKoreanPhone(recordValue(record, ["phone", "mobile", "phoneNumber", "phone_number"])),
    postalCode: explicitPostalCode || split.postalCode,
    address: split.address,
    note: recordValue(record, ["note", "deliveryNote", "delivery_note", "request", "specialNote"]),
    paymentTerm: recordValue(record, ["paymentTerm", "payment_term", "shippingPaymentTerm"]),
  };
}

export function buildShippingExportRow(input: ShippingExportInput): ShippingExportRow {
  const address = normalizeShippingAddressSnapshot(input.addressSnapshot);
  const memos = [...(input.memos ?? [])].slice(0, 4);
  while (memos.length < 4) memos.push("");

  return [
    address.recipientName,
    "",
    "",
    address.phone,
    address.postalCode,
    address.address,
    1,
    "의류",
    "",
    input.paymentTerm?.trim() || address.paymentTerm || "선불",
    input.dispatchReference?.trim() || input.requestId,
    input.note?.trim() || address.note,
    memos[0],
    memos[1],
    memos[2],
    memos[3],
  ];
}

function normalizeHeader(value: unknown): string {
  return spreadsheetCellText(value)
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s_\-()[\]{}./\\]+/g, "");
}

const TRACKING_HEADER_ALIASES: Record<TrackingImportField, ReadonlySet<string>> = {
  sequence: new Set(["순번", "번호", "no"]),
  trackingNumber: new Set(["운송장번호", "송장번호", "trackingnumber"]),
  recipientName: new Set(["받는분", "받으시는분", "수령인", "수령인명"]),
  phone: new Set(["받는분전화번호", "수령인전화번호", "전화번호"]),
  managerName: new Set(["받는분담당자", "수령인담당자", "담당자"]),
  mobile: new Set(["받는분휴대폰번호", "받는분핸드폰", "수령인휴대폰", "휴대폰번호"]),
  postalCode: new Set(["받는분우편번호", "수령인우편번호", "우편번호"]),
  address: new Set(["받는분주소", "받는분총주소", "수령인주소", "주소"]),
  quantity: new Set(["수량", "개수"]),
  senderName: new Set(["보내는사람", "보내는분", "발송인"]),
  itemName: new Set(["품목명", "품목", "상품명"]),
};

const TRACKING_FIELDS = Object.keys(TRACKING_HEADER_ALIASES) as TrackingImportField[];

function emptyDetectedColumns(): Record<TrackingImportField, number | null> {
  return {
    sequence: null,
    trackingNumber: null,
    recipientName: null,
    phone: null,
    managerName: null,
    mobile: null,
    postalCode: null,
    address: null,
    quantity: null,
    senderName: null,
    itemName: null,
  };
}

export function detectTrackingHeaderRow(rows: readonly SpreadsheetRow[]): DetectedTrackingHeaders | null {
  let best: { score: number; result: DetectedTrackingHeaders } | null = null;

  for (const row of rows.slice(0, TRACKING_HEADER_SCAN_LIMIT)) {
    const columns = emptyDetectedColumns();
    row.cells.forEach((cell, columnIndex) => {
      const header = normalizeHeader(cell);
      if (!header) return;
      for (const field of TRACKING_FIELDS) {
        if (columns[field] === null && TRACKING_HEADER_ALIASES[field].has(header)) {
          columns[field] = columnIndex;
          break;
        }
      }
    });

    const score = TRACKING_FIELDS.filter((field) => columns[field] !== null).length;
    const required = columns.trackingNumber !== null && columns.recipientName !== null;
    const hasContact = columns.phone !== null || columns.mobile !== null;
    if (required && hasContact && (!best || score > best.score)) {
      best = { score, result: { headerRowNumber: row.rowNumber, columns } };
    }
  }

  return best?.result ?? null;
}

function textAt(row: SpreadsheetRow, column: number | null): string {
  return column === null ? "" : spreadsheetCellText(row.cells[column]);
}

export function parseTrackingImportRows(
  rows: readonly SpreadsheetRow[],
  detected: DetectedTrackingHeaders,
): TrackingImportParseResult {
  const dataRows = rows.filter((row) => row.rowNumber > detected.headerRowNumber);
  if (dataRows.length > MAX_TRACKING_IMPORT_ROWS) {
    throw new Error(`송장 Excel은 최대 ${MAX_TRACKING_IMPORT_ROWS.toLocaleString("ko-KR")}행까지 등록할 수 있습니다.`);
  }

  const parsed: TrackingImportRow[] = [];
  const skippedRows: TrackingImportParseResult["skippedRows"] = [];
  for (const row of dataRows) {
    const value: TrackingImportRow = {
      rowNumber: row.rowNumber,
      sequence: textAt(row, detected.columns.sequence),
      trackingNumber: textAt(row, detected.columns.trackingNumber),
      recipientName: textAt(row, detected.columns.recipientName),
      phone: textAt(row, detected.columns.phone),
      managerName: textAt(row, detected.columns.managerName),
      mobile: textAt(row, detected.columns.mobile),
      postalCode: normalizePostalCode(textAt(row, detected.columns.postalCode)),
      address: splitLeadingPostalCode(textAt(row, detected.columns.address)).address,
      quantity: textAt(row, detected.columns.quantity),
      senderName: textAt(row, detected.columns.senderName),
      itemName: textAt(row, detected.columns.itemName),
    };
    const hasAnyValue = Object.entries(value).some(
      ([key, cell]) => key !== "rowNumber" && String(cell).trim().length > 0,
    );
    if (!hasAnyValue) continue;
    if (!value.trackingNumber) {
      skippedRows.push({ rowNumber: row.rowNumber, reason: "운송장번호가 없습니다." });
      continue;
    }
    if (!value.recipientName) {
      skippedRows.push({ rowNumber: row.rowNumber, reason: "받는분 이름이 없습니다." });
      continue;
    }
    parsed.push(value);
  }
  return { rows: parsed, skippedRows };
}

function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/[\s._\-()[\]]+/g, "");
}

function normalizeAddress(value: string): string {
  return splitLeadingPostalCode(value).address
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s,._\-()[\]]+/g, "");
}

function candidateMatches(row: TrackingImportRow, candidate: ShippingMatchCandidate): boolean {
  const address = normalizeShippingAddressSnapshot(candidate.addressSnapshot);
  if (normalizeName(row.recipientName) !== normalizeName(address.recipientName)) return false;

  // Carrier files may fill D, F, or both. Treat either matching contact as
  // evidence; conflicting rows still become ambiguous instead of being guessed.
  const rowPhones = new Set(
    [row.phone, row.mobile].map(normalizePhoneForMatch).filter(Boolean),
  );
  const candidatePhone = normalizePhoneForMatch(address.phone);
  const phoneMatches = Boolean(candidatePhone && rowPhones.has(candidatePhone));
  const rowPostal = normalizePostalCode(row.postalCode);
  const postalMatches = Boolean(rowPostal && address.postalCode && rowPostal === address.postalCode);
  const rowAddress = normalizeAddress(row.address);
  const candidateAddress = normalizeAddress(address.address);
  const addressMatches = Boolean(rowAddress && candidateAddress && rowAddress === candidateAddress);

  // A name alone is never enough: equal-name customers and repeat requests are common.
  if (!phoneMatches) return false;
  if (rowPostal && !postalMatches) return false;
  if (rowAddress && !addressMatches) return false;
  return true;
}

export function matchTrackingImportRows(
  rows: readonly TrackingImportRow[],
  candidates: readonly ShippingMatchCandidate[],
): TrackingMatchResult {
  const matched: MatchedTrackingImport[] = [];
  const ambiguous: AmbiguousTrackingImport[] = [];
  const unmatched: UnmatchedTrackingImport[] = [];

  for (const row of rows) {
    const candidateMatchesForRow = candidates.filter((candidate) => candidateMatches(row, candidate));
    if (candidateMatchesForRow.length === 0) {
      unmatched.push({
        row,
        reason: "받는분·연락처·우편번호·주소가 일치하는 배송 신청을 찾지 못했습니다.",
      });
    } else if (candidateMatchesForRow.length > 1) {
      ambiguous.push({
        row,
        candidateRequestIds: candidateMatchesForRow.map((candidate) => candidate.requestId),
        reason: "같은 수령 정보의 배송 신청이 여러 건이라 자동 연결할 수 없습니다.",
      });
    } else {
      matched.push({
        row,
        requestId: candidateMatchesForRow[0].requestId,
        trackingNumber: row.trackingNumber.trim(),
      });
    }
  }

  const rowsByRequestId = new Map<string, MatchedTrackingImport[]>();
  matched.forEach((entry) => {
    rowsByRequestId.set(entry.requestId, [...(rowsByRequestId.get(entry.requestId) ?? []), entry]);
  });
  const duplicatedRequestIds = new Set(
    [...rowsByRequestId.entries()].filter(([, entries]) => entries.length > 1).map(([requestId]) => requestId),
  );
  if (duplicatedRequestIds.size === 0) return { matched, ambiguous, unmatched };

  const uniqueMatches = matched.filter((entry) => !duplicatedRequestIds.has(entry.requestId));
  matched
    .filter((entry) => duplicatedRequestIds.has(entry.requestId))
    .forEach((entry) => {
      ambiguous.push({
        row: entry.row,
        candidateRequestIds: [entry.requestId],
        reason: "Excel의 여러 행이 같은 배송 신청에 연결되어 자동 등록하지 않았습니다.",
      });
    });
  return { matched: uniqueMatches, ambiguous, unmatched };
}
