export type AuctionClockStatus = "UPCOMING" | "OPEN" | "CLOSING_SOON" | "CLOSED" | "RE_AUCTION";

export interface AuctionTimerState { label: string; status: AuctionClockStatus; timeLeft: string; remainingSeconds: number; }

function kstDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function atKstTime(date: Date, hours = 0, minutes = 0, seconds = 0, nextDay = false) {
  const target = new Date(`${kstDateParts(date)}T00:00:00+09:00`);
  if (nextDay) target.setUTCDate(target.getUTCDate() + 1);
  target.setUTCHours(target.getUTCHours() + hours, minutes, seconds, 0);
  return target;
}

function formatTime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((unit) => String(unit).padStart(2, "0")).join(":");
}

export function getAuctionTimerState(now = new Date()): AuctionTimerState {
  if (Number.isNaN(now.getTime())) throw new RangeError("경매 타이머 시각이 올바르지 않습니다.");
  const biddingRestrictedAt = atKstTime(now, 20, 56);
  const closesAt = atKstTime(now, 21);
  const reopensAt = atKstTime(now, 22);
  let status: AuctionClockStatus; let target: Date; let label: string;
  if (now < biddingRestrictedAt) { status = "OPEN"; target = closesAt; label = "오늘 경매 마감까지"; }
  else if (now < closesAt) { status = "CLOSING_SOON"; target = closesAt; label = "오늘 경매 마감까지"; }
  else if (now < reopensAt) { status = "CLOSED"; target = reopensAt; label = "경매 마감 및 동기화 점검 종료까지"; }
  else { status = "RE_AUCTION"; target = atKstTime(now, 21, 0, 0, true); label = "미판매 경매 다음 마감까지"; }
  const remainingSeconds = Math.max(0, Math.floor((target.getTime() - now.getTime()) / 1000));
  return { label, status, timeLeft: formatTime(remainingSeconds), remainingSeconds };
}
