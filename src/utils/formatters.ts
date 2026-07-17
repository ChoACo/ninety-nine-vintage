import type {
  CountdownParts,
  KoreanWeekday,
  WeekdayGroup,
} from "@/src/types/auction";

export type DateInput = Date | string | number;

export interface KoreanDateFormatOptions {
  includeYear?: boolean;
  includeWeekday?: boolean;
}

export const AUCTION_TIME_ZONE = "Asia/Seoul";
export const AUCTION_CLOSE_HOUR = 21;
export const KOREAN_WEEKDAYS: readonly KoreanWeekday[] = [
  "월",
  "화",
  "수",
  "목",
  "금",
  "토",
  "일",
];

const KOREAN_WEEKDAY_BY_DAY_INDEX: readonly KoreanWeekday[] = [
  "일",
  "월",
  "화",
  "수",
  "목",
  "금",
  "토",
];

const KOREA_UTC_OFFSET_HOURS = 9;

const koreanDatePartFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: AUCTION_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function toDate(value: DateInput): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`유효하지 않은 날짜입니다: ${String(value)}`);
  }

  return date;
}

function getKoreanCalendarParts(value: DateInput) {
  const parts = koreanDatePartFormatter.formatToParts(toDate(value));
  const readPart = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find((item) => item.type === type)?.value;

    if (!part) {
      throw new RangeError("한국 시간대의 날짜를 계산할 수 없습니다.");
    }

    return Number(part);
  };

  return {
    year: readPart("year"),
    month: readPart("month"),
    day: readPart("day"),
  };
}

function formatCalendarKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0",
  )}`;
}

/** 한국 표준시 기준 YYYY-MM-DD 키를 반환합니다. 날짜 필터 비교에 사용합니다. */
export function getKoreanDateKey(value: DateInput = new Date()): string {
  const { year, month, day } = getKoreanCalendarParts(value);

  return formatCalendarKey(year, month, day);
}

/**
 * 기준일의 한국 달력 날짜에서 dayOffset만큼 이동한 YYYY-MM-DD 키를 만듭니다.
 * 서버와 브라우저의 로컬 시간대가 달라도 같은 날짜 탭을 구성할 수 있습니다.
 */
export function getRelativeKoreanDateKey(
  dayOffset: number,
  now: DateInput = new Date(),
): string {
  if (!Number.isInteger(dayOffset)) {
    throw new RangeError("날짜 이동 값은 정수여야 합니다.");
  }

  const { year, month, day } = getKoreanCalendarParts(now);
  const shifted = new Date(Date.UTC(year, month - 1, day + dayOffset));

  return formatCalendarKey(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/** 테스트나 서버 변환에서 한국 표준시 날짜/시각 ISO 문자열을 만들 때 사용합니다. */
export function getRelativeKoreanDateTime(
  dayOffset: number,
  time = "09:00:00",
  now: DateInput = new Date(),
): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time)) {
    throw new RangeError("시각은 HH:mm:ss 형식이어야 합니다.");
  }

  return `${getRelativeKoreanDateKey(dayOffset, now)}T${time}+09:00`;
}

/** 날짜 필터 칩에 표시할 '오늘/어제/7월 14일' 형식의 레이블입니다. */
export function formatKoreanDateChipLabel(
  value: DateInput,
  now: DateInput = new Date(),
): string {
  const dateKey = getKoreanDateKey(value);
  const dateLabel = formatKoreanDate(`${dateKey}T12:00:00+09:00`, {
    includeYear: false,
    includeWeekday: false,
  });

  if (dateKey === getKoreanDateKey(now)) {
    return `오늘 (${dateLabel})`;
  }

  if (dateKey === getRelativeKoreanDateKey(-1, now)) {
    return `어제 (${dateLabel})`;
  }

  return dateLabel;
}

export function formatKRW(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError("금액은 유한한 숫자여야 합니다.");
  }

  return `${new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 0,
  }).format(Math.round(value))}원`;
}

export function getKoreanWeekday(value: DateInput): KoreanWeekday {
  const { year, month, day } = getKoreanCalendarParts(value);
  const dayIndex = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return KOREAN_WEEKDAY_BY_DAY_INDEX[dayIndex];
}

export function formatKoreanDate(
  value: DateInput,
  {
    includeYear = true,
    includeWeekday = true,
  }: KoreanDateFormatOptions = {},
): string {
  const formattedDate = new Intl.DateTimeFormat("ko-KR", {
    timeZone: AUCTION_TIME_ZONE,
    year: includeYear ? "numeric" : undefined,
    month: "long",
    day: "numeric",
  }).format(toDate(value));

  return includeWeekday
    ? `${formattedDate} (${getKoreanWeekday(value)})`
    : formattedDate;
}

export function formatKoreanTime(
  value: DateInput,
  includeSeconds = false,
): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: AUCTION_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    second: includeSeconds ? "2-digit" : undefined,
    hour12: true,
  }).format(toDate(value));
}

export function groupByWeekday<T>(
  items: readonly T[],
  getDate: (item: T) => DateInput,
): WeekdayGroup<T>[] {
  const buckets = new Map<KoreanWeekday, T[]>(
    KOREAN_WEEKDAYS.map((weekday) => [weekday, []]),
  );

  items.forEach((item) => {
    buckets.get(getKoreanWeekday(getDate(item)))?.push(item);
  });

  return KOREAN_WEEKDAYS.flatMap((weekday) => {
    const groupedItems = buckets.get(weekday) ?? [];

    return groupedItems.length > 0
      ? [{ weekday, items: groupedItems } satisfies WeekdayGroup<T>]
      : [];
  });
}

export function getTodayAuctionDeadline(now: DateInput = new Date()): Date {
  const { year, month, day } = getKoreanCalendarParts(now);

  return new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      AUCTION_CLOSE_HOUR - KOREA_UTC_OFFSET_HOURS,
    ),
  );
}

export function getNextAuctionDeadline(now: DateInput = new Date()): Date {
  const current = toDate(now);
  const todayDeadline = getTodayAuctionDeadline(current);

  if (current.getTime() < todayDeadline.getTime()) {
    return todayDeadline;
  }

  const { year, month, day } = getKoreanCalendarParts(current);

  return new Date(
    Date.UTC(
      year,
      month - 1,
      day + 1,
      AUCTION_CLOSE_HOUR - KOREA_UTC_OFFSET_HOURS,
    ),
  );
}

export function getCountdown(
  target: DateInput,
  now: DateInput = new Date(),
): CountdownParts {
  const difference = toDate(target).getTime() - toDate(now).getTime();
  const totalMilliseconds = Math.max(0, difference);
  const totalSeconds = Math.ceil(totalMilliseconds / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return {
    totalMilliseconds,
    totalSeconds,
    days,
    hours,
    minutes,
    seconds,
    isExpired: difference <= 0,
  };
}

export function formatCountdown(countdown: CountdownParts): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const clock = `${pad(countdown.hours)}:${pad(countdown.minutes)}:${pad(
    countdown.seconds,
  )}`;

  return countdown.days > 0 ? `${countdown.days}일 ${clock}` : clock;
}
