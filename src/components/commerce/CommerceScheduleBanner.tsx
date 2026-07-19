"use client";

export interface CommerceScheduleBannerProps {
  className?: string;
  compact?: boolean;
}

const scheduleItems = [
  {
    time: "10:00",
    eyebrow: "DAILY DROP",
    title: "신상품 공개",
    description: "매일 오전 10시 새로운 셀렉션을 공개합니다.",
  },
  {
    time: "22:00",
    eyebrow: "SECOND ROUND",
    title: "유찰 상품 재입찰",
    description: "낙찰되지 않은 상품은 오후 10시에 다시 참여할 수 있습니다.",
  },
] as const;

export default function CommerceScheduleBanner({
  className = "",
  compact = false,
}: CommerceScheduleBannerProps) {
  return (
    <aside
      aria-label="나인티 나인 빈티지 상품 공개 일정"
      className={`overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-sm ${className}`}
    >
      <div className="grid divide-y divide-[var(--border)] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        {scheduleItems.map((item) => (
          <div
            key={item.time}
            className={`group flex items-center gap-3 transition-colors duration-200 hover:bg-[var(--surface-muted)] ${
              compact ? "px-3 py-2.5" : "px-4 py-3.5 sm:px-5 sm:py-4"
            }`}
          >
            <span className="inline-flex min-h-10 shrink-0 items-center rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 font-mono text-sm font-black tabular-nums tracking-tight text-[var(--text-strong)]">
              {item.time}
            </span>
            <span className="min-w-0">
              <span className="block text-[9px] font-black tracking-[0.16em] text-[var(--accent-text)]">
                {item.eyebrow}
              </span>
              <span className="mt-0.5 block text-xs font-black tracking-[-0.02em] text-[var(--text-strong)] sm:text-sm">
                {item.title}
              </span>
              {!compact ? (
                <span className="mt-0.5 block break-keep text-[11px] font-medium leading-4 text-[var(--text-muted)] sm:text-xs sm:leading-5">
                  {item.description}
                </span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}
