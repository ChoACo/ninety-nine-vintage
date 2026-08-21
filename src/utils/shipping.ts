import { formatKoreanDate } from "@/src/utils/formatters";

export const SHIPPING_FEE = 4_000;
export const REGULAR_KEEP_DAYS = 14;
export const BULKY_KEEP_DAYS = 7;

const ONE_DAY_MS = 86_400_000;
const KOREAN_TIME_ZONE = "Asia/Seoul";

type DateInput = Date | string | number;

function toDate(value: DateInput): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`유효하지 않은 날짜입니다: ${String(value)}`);
  }

  return date;
}

function getKoreanCalendarParts(value: DateInput) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KOREAN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(toDate(value));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return { year: read("year"), month: read("month"), day: read("day") };
}

export function getKeepLimitDays(isBulky: boolean): number {
  return isBulky ? BULKY_KEEP_DAYS : REGULAR_KEEP_DAYS;
}

/** 결제 완료 시각부터 일반 의류 14일, 부피 상품 7일 뒤의 보관 만료 시각입니다. */
export function getKeepExpiration(
  paidAt: DateInput,
  isBulky: boolean,
): string {
  const deadline = new Date(
    toDate(paidAt).getTime() + getKeepLimitDays(isBulky) * ONE_DAY_MS,
  );

  return deadline.toISOString();
}

export function getRemainingKeepDays(
  expiresAt: DateInput,
  now: DateInput = new Date(),
): number {
  return Math.max(
    0,
    Math.ceil((toDate(expiresAt).getTime() - toDate(now).getTime()) / ONE_DAY_MS),
  );
}

export function formatKeepDday(
  expiresAt: DateInput,
  now: DateInput = new Date(),
): string {
  const difference = toDate(expiresAt).getTime() - toDate(now).getTime();

  if (difference <= 0) return "보관 만료";

  const days = getRemainingKeepDays(expiresAt, now);
  return days <= 0 ? "D-DAY" : `D-${days}`;
}

/** 만료일까지 남은 날짜를 한국 표준시 달력 기준으로 계산합니다. 지났으면 음수입니다. */
export function getKstCalendarDaysUntil(
  expiresAt: DateInput,
  now: DateInput = new Date(),
): number {
  const end = getKoreanCalendarParts(expiresAt);
  const start = getKoreanCalendarParts(now);

  return Math.round(
    (Date.UTC(end.year, end.month - 1, end.day) -
      Date.UTC(start.year, start.month - 1, start.day)) / ONE_DAY_MS,
  );
}

export function formatStorageDday(daysLeft: number): string {
  if (daysLeft < 0) return `D+${Math.abs(daysLeft)}`;
  if (daysLeft === 0) return "D-Day";
  return `D-${daysLeft}`;
}

export function storageUrgencyClass(daysLeft: number | null): string {
  if (daysLeft === null) return "";
  if (daysLeft <= 0) return "border-red-500 bg-red-50 text-red-700";
  if (daysLeft <= 2) return "border-amber-500 bg-amber-50 text-amber-800";
  if (daysLeft <= 7) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-line text-muted";
}

export function storageUrgencySurfaceClass(daysLeft: number | null): string {
  if (daysLeft === null) return "";
  if (daysLeft <= 0) return "bg-red-50";
  if (daysLeft <= 2) return "bg-amber-50";
  return "";
}

export function storageClassLabel(durationDays: number | null): string {
  return durationDays === BULKY_KEEP_DAYS ? "대형 · 7일 보관" : "소형 · 14일 보관";
}

/**
 * 신청일 다음 날 이후 처음 만나는 화·수·목 오후 5시(KST)를 반환합니다.
 * 목~일 신청은 다음 주 화요일로 넘어갑니다.
 */
export function getNextShippingDispatchDate(
  requestedAt: DateInput = new Date(),
): string {
  const { year, month, day } = getKoreanCalendarParts(requestedAt);

  for (let dayOffset = 1; dayOffset <= 7; dayOffset += 1) {
    const candidate = new Date(Date.UTC(year, month - 1, day + dayOffset));
    const weekday = candidate.getUTCDay();

    if (weekday === 2 || weekday === 3 || weekday === 4) {
      const dateKey = `${candidate.getUTCFullYear()}-${String(
        candidate.getUTCMonth() + 1,
      ).padStart(2, "0")}-${String(candidate.getUTCDate()).padStart(2, "0")}`;

      return `${dateKey}T17:00:00+09:00`;
    }
  }

  throw new RangeError("발송 예정일을 계산할 수 없습니다.");
}

export function formatShippingDispatchNotice(scheduledAt: DateInput): string {
  const dateLabel = formatKoreanDate(scheduledAt, {
    includeYear: false,
  }).replace(" (", "(");

  return `배송 예정일: ${dateLabel} 오후 5시 한진택배 발송 예정`;
}
