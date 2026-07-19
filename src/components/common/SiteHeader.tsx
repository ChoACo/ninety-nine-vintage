"use client";

/* eslint-disable @next/next/no-img-element -- 검증된 로컬 브랜드 자산을 작은 헤더 로고로 사용합니다. */

import Link from "next/link";
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
  isSigningOut?: boolean;
  onSignOut?: () => void | Promise<void>;
}

export default function SiteHeader({
  role,
  isAuthenticated,
  displayName,
  onOpenAuth,
  isSigningOut = false,
  onSignOut,
}: SiteHeaderProps) {
  const roleLabel = getPublicRoleLabel(role);
  const safeDisplayName = isOwnerRole(role) ? "" : displayName?.trim();

  return (
    <header className="theme-surface-glass rounded-xl border px-3 py-2.5 sm:px-4 sm:py-3">
      <div className="flex items-center justify-between gap-2.5 lg:gap-5">
        <Link
          href="/"
          aria-label="나인티 나인 빈티지 홈으로 이동"
          className="flex min-w-0 items-center gap-3 rounded-lg transition-opacity duration-200 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          <img
            src="/ninety-nine-vintage-brand.jpg"
            alt="나인티 나인 빈티지 공식 로고"
            width={96}
            height={96}
            decoding="async"
            fetchPriority="high"
            className="aspect-square size-10 shrink-0 rounded-md border border-[var(--border)] object-cover shadow-[0_5px_16px_rgba(18,18,17,0.16)] sm:size-11"
          />
          <div className="min-w-0">
            <p className="truncate text-[9px] font-bold tracking-[0.22em] text-[var(--text-muted)] sm:text-[10px]">
              NINETY-NINE · LIVE AUCTION
            </p>
            <h1 className="mt-0.5 truncate text-[17px] font-extrabold tracking-[-0.04em] text-[var(--text-strong)] sm:text-xl">
              나인티 나인 빈티지
            </h1>
          </div>
        </Link>

        <div className="flex shrink-0 items-center gap-1.5 lg:justify-end lg:gap-2">
          <ThemeToggle />

          {isAuthenticated ? (
            <span className="hidden min-h-10 max-w-[12rem] items-center gap-2 truncate rounded-md border border-[var(--border)] bg-[var(--success-surface)] px-3 py-2 text-xs font-bold text-[var(--success-text)] sm:inline-flex sm:max-w-[16rem]">
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
              <span className="truncate">
                {safeDisplayName ? `${safeDisplayName} · ` : ""}
                {roleLabel}
              </span>
            </span>
          ) : (
            <Button className="px-3" size="sm" onClick={onOpenAuth}>
              카카오로 시작하기
            </Button>
          )}

          {isAuthenticated && onSignOut ? (
            <Button
              variant="ghost"
              size="sm"
              className="px-3"
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
