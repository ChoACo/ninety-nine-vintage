"use client";

/* eslint-disable @next/next/no-img-element -- 검증된 로컬 브랜드 자산을 작은 헤더 로고로 사용합니다. */

import {
  getPublicRoleLabel,
  isOwnerRole,
  type AppRole,
} from "@/src/lib/supabase/auth";
import Button from "./Button";
import ThemeToggle from "./ThemeToggle";

export interface SiteHeaderProps {
  role: AppRole;
  isAuthenticated: boolean;
  displayName?: string;
  onOpenAuth: () => void;
  onOpenOwnerTools?: () => void;
  isSigningOut?: boolean;
  onSignOut?: () => void | Promise<void>;
}

export default function SiteHeader({
  role,
  isAuthenticated,
  displayName,
  onOpenAuth,
  onOpenOwnerTools,
  isSigningOut = false,
  onSignOut,
}: SiteHeaderProps) {
  const roleLabel = getPublicRoleLabel(role);
  const safeDisplayName = isOwnerRole(role) ? "" : displayName?.trim();

  return (
    <header className="theme-surface-glass rounded-[1.5rem] border px-3 py-3 sm:rounded-[1.75rem] sm:px-5 sm:py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <img
            src="/ninety-nine-vintage-brand.jpg"
            alt="나인티 나인 빈티지 공식 로고"
            width={96}
            height={96}
            decoding="async"
            fetchPriority="high"
            className="aspect-square size-10 shrink-0 rounded-[0.9rem] object-cover shadow-[0_7px_18px_rgba(83,50,39,0.18)] sm:size-12 sm:rounded-[1.05rem]"
          />
          <div className="min-w-0">
            <p className="truncate text-[10px] font-extrabold tracking-[0.16em] text-[var(--accent-text)] sm:text-xs">
              NINETY-NINE VINTAGE AUCTION
            </p>
            <h1 className="mt-0.5 truncate text-[18px] font-black tracking-[-0.045em] text-[var(--text-strong)] sm:text-[22px]">
              나인티 나인 빈티지
            </h1>
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:justify-end sm:gap-2">
          <ThemeToggle />

          {isAuthenticated &&
          isOwnerRole(role) &&
          onOpenOwnerTools ? (
            <Button className="!min-h-10 !rounded-xl !px-3 text-sm" size="sm" variant="secondary" onClick={onOpenOwnerTools}>
              관리자 메뉴
            </Button>
          ) : null}

          {isAuthenticated ? (
            <span className="min-h-10 max-w-[11rem] truncate rounded-xl bg-[var(--success-surface)] px-3 py-2 text-sm font-bold text-[var(--success-text)] sm:max-w-[15rem]">
              {safeDisplayName ? `${safeDisplayName} · ` : ""}
              {roleLabel}
            </span>
          ) : (
            <Button className="!min-h-10 !rounded-xl !px-3 text-sm" size="sm" onClick={onOpenAuth}>
              카카오로 시작하기
            </Button>
          )}

          {isAuthenticated && onSignOut ? (
            <Button
              variant="ghost"
              size="sm"
              className="!min-h-10 !rounded-xl !px-3 text-sm"
              isLoading={isSigningOut}
              onClick={() => void onSignOut()}
            >
              {isSigningOut ? "로그아웃 중..." : "로그아웃"}
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
