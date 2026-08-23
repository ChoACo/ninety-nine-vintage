"use client";

import Link from "next/link";

interface MobileBidBarProps {
  actionHref?: string;
  actionLabel: string;
  currentBid: number;
  disabled?: boolean;
  onAction?: () => void;
  remainingTime: string;
}

const actionClassName =
  "flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg transition active:scale-95 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none";

export function MobileBidBar({
  actionHref,
  actionLabel,
  currentBid,
  disabled = false,
  onAction,
  remainingTime,
}: Readonly<MobileBidBarProps>) {
  return (
    <div
      className="mobile-bid-bar fixed left-0 right-0 z-40 flex items-center justify-between gap-4 border-t border-border/50 bg-background/90 px-4 py-3 text-foreground shadow-xl backdrop-blur-xl lg:hidden"
      data-mobile-bid-bar
    >
      <div className="min-w-0">
        <p className="flex items-center gap-1 truncate font-mono text-xs text-muted-foreground">
          <span aria-hidden="true">⏱</span> {remainingTime}
        </p>
        <p className="mt-0.5 truncate font-mono text-base font-bold text-primary tabular-nums">
          {currentBid.toLocaleString("ko-KR")}원
        </p>
      </div>
      {actionHref && !disabled ? (
        <Link className={actionClassName} href={actionHref}>
          {actionLabel}
        </Link>
      ) : (
        <button
          className={actionClassName}
          disabled={disabled}
          onClick={onAction}
          type="button"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
