import type { UserBidStatus } from "@/src/utils/bidStatus";

export interface BidParticipationBadgeProps {
  status: UserBidStatus;
  className?: string;
}

const participationPresentation = {
  "user-leading": {
    label: "입찰 중",
    className:
      "border-[var(--success-text)]/30 bg-[var(--success-surface)] text-[var(--success-text)]",
    dotClassName: "bg-[var(--success-text)]",
  },
  "user-outbid": {
    label: "상위 입찰 발생",
    className:
      "border-[var(--warning-text)]/35 bg-[var(--warning-surface)] text-[var(--warning-text)]",
    dotClassName:
      "bg-[var(--warning-text)] motion-safe:animate-pulse",
  },
} as const;

/**
 * 공개 입찰 원장으로 확정할 수 있는 회원 본인의 현재 참여 상태만 표시합니다.
 * 결제 상태는 AuctionPost에 존재하지 않으므로 이 배지에서 추정하지 않습니다.
 */
export default function BidParticipationBadge({
  status,
  className = "",
}: BidParticipationBadgeProps) {
  if (status !== "user-leading" && status !== "user-outbid") return null;

  const presentation = participationPresentation[status];

  return (
    <span
      role="status"
      data-participation-status={status}
      className={`inline-flex min-h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-black leading-none tracking-[-0.01em] ${presentation.className} ${className}`}
      aria-label={`내 입찰 상태: ${presentation.label}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${presentation.dotClassName}`}
      />
      {presentation.label}
    </span>
  );
}
