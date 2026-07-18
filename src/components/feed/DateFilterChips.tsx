"use client";

const KOREA_TIME_ZONE = "Asia/Seoul";

function getCalendarParts(value: Date | string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: KOREA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const read = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
  };
}

export function getKoreanDateKey(value: Date | string) {
  const { year, month, day } = getCalendarParts(value);
  return `${year}-${month}-${day}`;
}

function shiftDateKey(dateKey: string, amount: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + amount));
  return shifted.toISOString().slice(0, 10);
}

function getChipLabel(dateKey: string, todayKey: string) {
  const [, month, day] = dateKey.split("-").map(Number);
  const dateLabel = `${month}월 ${day}일`;

  if (dateKey === todayKey) return `오늘 (${dateLabel})`;
  if (dateKey === shiftDateKey(todayKey, -1)) return `어제 (${dateLabel})`;
  return dateLabel;
}

export interface DateFilterChipsProps {
  dateKeys: string[];
  selectedDate: string;
  onSelect: (dateKey: string) => void;
}

export default function DateFilterChips({
  dateKeys,
  selectedDate,
  onSelect,
}: DateFilterChipsProps) {
  const todayKey = getKoreanDateKey(new Date());
  const options = [
    { value: "all", label: "전체보기" },
    ...dateKeys.map((dateKey) => ({
      value: dateKey,
      label: getChipLabel(dateKey, todayKey),
    })),
  ];

  return (
    <nav aria-label="상품 등록 날짜 선택" className="relative">
      <div className="flex snap-x gap-1 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {options.map((option) => {
          const isSelected = selectedDate === option.value;

          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(option.value)}
              className={`min-h-10 shrink-0 snap-start rounded-md border px-4 py-2 text-sm font-bold tracking-[-0.01em] transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
                isSelected
                  ? "border-[var(--text-strong)] bg-[var(--text-strong)] text-[var(--surface)] shadow-sm"
                  : "border-transparent bg-transparent text-[var(--text-muted)] hover:scale-[1.02] hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-strong)]"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
