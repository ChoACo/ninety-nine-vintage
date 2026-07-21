export type AuctionClockStatus =
  | "UPCOMING"
  | "OPEN"
  | "CLOSING_SOON"
  | "CLOSED"
  | "RE_AUCTION";

export interface AuctionTimerState {
  label: string;
  status: AuctionClockStatus;
  timeLeft: string;
  remainingSeconds: number;
}

function kstDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function atKstTime(
  date: Date,
  hours = 0,
  minutes = 0,
  seconds = 0,
  nextDay = false,
) {
  const target = new Date(`${kstDateParts(date)}T00:00:00+09:00`);
  if (nextDay) target.setUTCDate(target.getUTCDate() + 1);
  target.setUTCHours(target.getUTCHours() + hours, minutes, seconds, 0);
  return target;
}

function formatTime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((unit) => String(unit).padStart(2, "0"))
    .join(":");
}

export function getAuctionTimerState(now = new Date()): AuctionTimerState {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError("경매 타이머 시각이 올바르지 않습니다.");
  }

  const opensAt = atKstTime(now, 10);
  const biddingRestrictedAt = atKstTime(now, 20, 56);
  const closesAt = atKstTime(now, 21);
  const reAuctionStartsAt = atKstTime(now, 22);
  const nextBiddingRestrictedAt = atKstTime(now, 20, 56, 0, true);

  let status: AuctionClockStatus;
  let target: Date;
  let label: string;

  if (now < opensAt) {
    status = "UPCOMING";
    target = opensAt;
    label = "오늘 경매 공개까지";
  } else if (now < biddingRestrictedAt) {
    status = "OPEN";
    target = biddingRestrictedAt;
    label = "신규 참여 제한까지";
  } else if (now < closesAt) {
    status = "CLOSING_SOON";
    target = closesAt;
    label = "오늘 경매 마감까지";
  } else if (now < reAuctionStartsAt) {
    status = "CLOSED";
    target = reAuctionStartsAt;
    label = "미판매 상품 재오픈까지";
  } else {
    status = "RE_AUCTION";
    target = nextBiddingRestrictedAt;
    label = "다음 신규 참여 제한까지";
  }

  const remainingSeconds = Math.max(
    0,
    Math.floor((target.getTime() - now.getTime()) / 1000),
  );

  return {
    label,
    status,
    timeLeft: formatTime(remainingSeconds),
    remainingSeconds,
  };
}
