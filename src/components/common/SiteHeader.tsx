"use client";

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
    <header className="theme-surface-glass rounded-[2rem] border p-4 backdrop-blur sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="grid h-12 w-12 shrink-0 rotate-[-3deg] place-items-center rounded-[1.1rem] bg-[var(--accent)] text-base font-black text-white shadow-[0_8px_20px_rgba(218,103,84,0.26)]"
          >
            다미
          </div>
          <div>
            <p className="text-xs font-bold tracking-[0.18em] text-[var(--accent-text)]">
              TRUSTED VINTAGE CLOTHING AUCTION
            </p>
            <h1 className="mt-0.5 text-xl font-black tracking-[-0.04em] text-[var(--text-strong)] sm:text-2xl">
              다미네 구제
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <ThemeToggle />

          {isAuthenticated &&
          isOwnerRole(role) &&
          onOpenOwnerTools ? (
            <Button size="sm" variant="secondary" onClick={onOpenOwnerTools}>
              관리자 메뉴
            </Button>
          ) : null}

          {isAuthenticated ? (
            <span className="rounded-full bg-[var(--success-surface)] px-3 py-1.5 text-sm font-bold text-[var(--success-text)]">
              {safeDisplayName ? `${safeDisplayName} · ` : ""}
              {roleLabel}
            </span>
          ) : (
            <Button size="sm" onClick={onOpenAuth}>
              카카오로 시작하기
            </Button>
          )}

          {isAuthenticated && onSignOut ? (
            <Button
              variant="ghost"
              size="sm"
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
