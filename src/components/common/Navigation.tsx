"use client";

/* eslint-disable @next/next/no-img-element -- 검증된 로컬 브랜드 자산을 데스크톱 GNB에 표시합니다. */

import Link from "next/link";
import {
  canAccessOperationsCenter,
  canAccessOperationsWorkspace,
  isMemberRole,
  isOwnerRole,
  type AppRole,
} from "@/src/lib/supabase/auth";
import Button from "./Button";
import ThemeToggle from "./ThemeToggle";

export type NavigationTarget = "feed" | "chat" | "profile" | "admin";

export interface NavigationProps {
  activePage: NavigationTarget | "home" | "shop" | "sold";
  onNavigate: (page: NavigationTarget) => void;
  onOpenOwnerTools?: () => void;
  role: AppRole;
  isAuthenticated?: boolean;
  displayName?: string;
  onOpenAuth?: () => void;
  isSigningOut?: boolean;
  onSignOut?: () => void | Promise<void>;
  className?: string;
}

const navigationItems: Array<{
  value: NavigationTarget;
  label: string;
  icon: "home" | "chat" | "profile" | "operations";
  staffOnly?: boolean;
}> = [
  { value: "feed", label: "경매 피드", icon: "home" },
  { value: "chat", label: "채팅", icon: "chat" },
  { value: "profile", label: "내 정보", icon: "profile" },
  { value: "admin", label: "운영 센터", icon: "operations", staffOnly: true },
];

const desktopCommerceItems = [
  { href: "/", label: "홈", activePage: "home", icon: "home" },
  { href: "/feed", label: "라이브 경매", activePage: "feed", icon: "live" },
  {
    href: "/shop",
    label: "상시 구매",
    activePage: "shop",
    icon: "shop",
    isNew: true,
  },
  {
    href: "/sold",
    label: "브랜드 아카이브",
    activePage: "sold",
    icon: "archive",
  },
] as const;

function CommerceNavigationIcon({
  name,
}: {
  name: (typeof desktopCommerceItems)[number]["icon"];
}) {
  const paths = {
    home: <path d="M3.5 10.5 12 3.4l8.5 7.1v9.1a1.4 1.4 0 0 1-1.4 1.4h-4.7v-6.1H9.6V21H4.9a1.4 1.4 0 0 1-1.4-1.4Z" />,
    live: <path d="M5.5 14.5c2.5-1 3.3-3.1 3-6.2 2.6 1.5 4 3.8 3.9 6.4 1.8-.9 2.8-2.5 2.9-4.8 2.1 2 3.2 4.2 3.2 6.5A6.4 6.4 0 0 1 12 22a6.5 6.5 0 0 1-6.5-7.5Zm7.9 2.3c.1 1.2-.4 2.1-1.4 2.8-1-.7-1.5-1.6-1.4-2.8.1-1 .6-1.9 1.4-2.7.8.8 1.3 1.7 1.4 2.7Z" />,
    shop: <path d="M4.2 9.3h15.6l-1 11.2H5.2l-1-11.2ZM8 9.3V7a4 4 0 0 1 8 0v2.3" />,
    archive: <path d="M4 5.5h16v4H4v-4Zm1.5 4h13v11h-13v-11Zm4 4h5" />,
  } as const;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4 shrink-0"
    >
      {paths[name]}
    </svg>
  );
}

function NavigationIcon({
  name,
}: {
  name: (typeof navigationItems)[number]["icon"];
}) {
  const paths = {
    home: <path d="M3 10.7 12 3l9 7.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-5v-6h-5v6h-5A1.5 1.5 0 0 1 3 19.5Z" />,
    chat: <path d="M5 18.5 3.7 21l3.7-1.1A9 9 0 1 0 3 12c0 2.5.7 4.7 2 6.5Zm3-8h8m-8 4h5" />,
    profile: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7.5 8c.7-4 3.2-6 7.5-6s6.8 2 7.5 6" />,
    operations: <path d="M4 6.5h10m3 0h3M4 12h3m3 0h10M4 17.5h8m3 0h5M14 4v5M7 9.5v5m5 1v4" />,
  } as const;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-[21px] shrink-0"
    >
      {paths[name]}
    </svg>
  );
}

export default function Navigation({
  activePage,
  onNavigate,
  onOpenOwnerTools,
  role,
  isAuthenticated = false,
  displayName,
  onOpenAuth,
  isSigningOut = false,
  onSignOut,
  className = "",
}: NavigationProps) {
  const visibleNavigationItems = navigationItems.filter(
    (item) =>
      (!item.staffOnly || canAccessOperationsWorkspace(role)) &&
      !(isOwnerRole(role) && item.value === "profile"),
  );

  const hasOperationsCenterAccess = canAccessOperationsCenter(role);
  const hasEmployeeWorkspaceAccess = role === "employee";
  const desktopUtilityButtonClasses =
    "inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent px-2.5 text-xs font-black tracking-[-0.015em] text-[var(--text-muted)] transition-all duration-200 ease-out hover:border-[var(--border)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-strong)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] xl:px-3";

  return (
    <>
      <nav
        aria-label="모바일 주요 메뉴"
        className={`app-primary-navigation theme-surface-glass fixed inset-x-2 z-40 mx-auto max-w-[28rem] rounded-xl border p-1 md:hidden ${className}`}
      >
        <div
          className={`grid gap-0.5 sm:gap-1 ${
            visibleNavigationItems.length === 4 ? "grid-cols-4" : "grid-cols-3"
          }`}
        >
          {visibleNavigationItems.map((item) => {
            const selected = activePage === item.value;
            const isOperationsWorkspace = canAccessOperationsWorkspace(role);
            const isChatAllowed =
              role === "unauthorized" ||
              isMemberRole(role) ||
              role === "employee" ||
              canAccessOperationsCenter(role);
            const isLocked =
              (item.staffOnly && !isOperationsWorkspace) ||
              (item.value === "chat" && !isChatAllowed);
            const visibleLabel =
              item.value === "admin" && role === "employee"
                  ? "업무 도구"
                  : item.value === "admin" && canAccessOperationsCenter(role)
                    ? "운영 관제"
                  : item.value === "chat" && canAccessOperationsCenter(role)
                    ? "상담 대화함"
                    : item.label;

            return (
              <button
                key={item.value}
                type="button"
                aria-current={selected ? "page" : undefined}
                aria-disabled={isLocked || undefined}
                aria-label={
                  isLocked
                    ? `${visibleLabel}, 허용된 운영 역할에서 이용 가능`
                    : visibleLabel
                }
                onClick={() => {
                  if (isLocked) return;
                  if (
                    item.value === "admin" &&
                    isOwnerRole(role) &&
                    onOpenOwnerTools
                  ) {
                    onOpenOwnerTools();
                    return;
                  }
                  onNavigate(item.value);
                }}
                className={`group relative flex min-h-[3.25rem] min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1.5 text-[10px] font-bold leading-tight tracking-[-0.015em] transition-all duration-200 ease-out focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] sm:min-h-13 sm:flex-row sm:gap-2 sm:px-3 sm:text-sm ${
                  selected
                    ? "border-transparent bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[0_6px_16px_rgba(18,18,17,0.16)]"
                    : isLocked
                      ? "border-transparent text-[var(--text-muted)] opacity-55"
                      : "border-transparent text-[var(--text-muted)] hover:-translate-y-0.5 hover:border-[var(--border)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-strong)] hover:shadow-[0_5px_14px_rgba(18,18,17,0.08)] active:translate-y-0"
                }`}
              >
                <NavigationIcon name={item.icon} />
                <span className="max-w-full truncate whitespace-nowrap">{visibleLabel}</span>
                {isLocked ? (
                  <span
                    className="absolute right-1.5 top-1.5 grid size-3.5 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface-muted)] text-[8px] text-[var(--text-muted)] sm:static sm:size-auto sm:rounded-sm sm:px-1.5 sm:py-0.5 sm:text-[9px]"
                    aria-label="잠금"
                  >
                    <span aria-hidden="true">●</span>
                    <span className="sr-only sm:not-sr-only">잠금</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      <nav
        aria-label="데스크톱 글로벌 메뉴"
        className={`theme-surface-glass sticky top-2 z-40 mx-auto hidden w-[calc(100%_-_1.5rem)] max-w-[1632px] items-center gap-2 rounded-xl border px-2 py-1.5 shadow-[0_12px_34px_rgba(18,18,17,0.12)] backdrop-blur-xl md:flex lg:gap-3 ${className}`}
      >
        <Link
          href="/"
          aria-label="나인티 나인 빈티지 홈"
          className="flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-1.5 transition-all duration-200 hover:bg-[var(--surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] lg:pr-3"
        >
          <img
            src="/ninety-nine-vintage-brand.jpg"
            alt=""
            width={36}
            height={36}
            className="size-8 rounded-md border border-[var(--border)] object-cover"
          />
          <span className="hidden border-r border-[var(--border)] pr-3 xl:block">
            <span className="block text-[9px] font-black tracking-[0.16em] text-[var(--text-muted)]">
              NINETY-NINE
            </span>
            <span className="block text-xs font-black tracking-[-0.03em] text-[var(--text-strong)]">
              VINTAGE
            </span>
          </span>
        </Link>

        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {desktopCommerceItems.map((item) => {
            const selected =
              "activePage" in item && item.activePage === activePage;
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                aria-current={selected ? "page" : undefined}
                className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-black tracking-[-0.015em] transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] lg:px-3 lg:text-[13px] ${
                  selected
                    ? "bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[0_6px_16px_rgba(18,18,17,0.14)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-strong)]"
                }`}
              >
                <CommerceNavigationIcon name={item.icon} />
                <span>{item.label}</span>
                {"isNew" in item && item.isNew ? (
                  <span className="rounded-sm bg-emerald-500/15 px-1 py-0.5 font-mono text-[8px] font-black tracking-[0.08em] text-emerald-600">
                    NEW
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-0.5 border-l border-[var(--border)] pl-2 lg:gap-1 lg:pl-3">
          <button
            type="button"
            onClick={() => onNavigate("chat")}
            className={desktopUtilityButtonClasses}
          >
            <NavigationIcon name="chat" />
            <span className="hidden lg:inline">상담</span>
          </button>
          {!isOwnerRole(role) ? (
            <button
              type="button"
              onClick={() => onNavigate("profile")}
              className={desktopUtilityButtonClasses}
            >
              <NavigationIcon name="profile" />
              <span className="hidden lg:inline">내 정보</span>
            </button>
          ) : null}
          {hasOperationsCenterAccess || hasEmployeeWorkspaceAccess ? (
            <button
              type="button"
              onClick={() => {
                if (isOwnerRole(role) && onOpenOwnerTools) {
                  onOpenOwnerTools();
                  return;
                }
                onNavigate("admin");
              }}
              className={`${desktopUtilityButtonClasses} border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-strong)]`}
            >
              <NavigationIcon name="operations" />
              <span className="hidden lg:inline">
                {hasOperationsCenterAccess ? "운영 관제" : "업무 도구"}
              </span>
            </button>
          ) : null}
          <ThemeToggle />
          {!isAuthenticated && onOpenAuth ? (
            <Button size="sm" className="ml-1 whitespace-nowrap px-3" onClick={onOpenAuth}>
              카카오 시작
            </Button>
          ) : null}
          {isAuthenticated && onSignOut ? (
            <div className="ml-1 hidden items-center gap-1 border-l border-[var(--border)] pl-2 xl:flex">
              {displayName ? (
                <span className="max-w-28 truncate px-1 text-[11px] font-black text-[var(--text-muted)]">
                  {displayName}
                </span>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="px-2.5"
                isLoading={isSigningOut}
                onClick={() => void onSignOut()}
              >
                {isSigningOut ? "처리 중" : "로그아웃"}
              </Button>
            </div>
          ) : null}
        </div>
      </nav>
    </>
  );
}
