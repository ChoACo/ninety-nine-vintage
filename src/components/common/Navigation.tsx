"use client";

import {
  canAccessOperationsCenter,
  canAccessOperationsWorkspace,
  isMemberRole,
  isOwnerRole,
  type AppRole,
} from "@/src/lib/supabase/auth";

export type NavigationTarget = "feed" | "chat" | "profile" | "admin";

export interface NavigationProps {
  activePage: NavigationTarget;
  onNavigate: (page: NavigationTarget) => void;
  role: AppRole;
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
  role,
  className = "",
}: NavigationProps) {
  const visibleNavigationItems = navigationItems.filter(
    (item) => !item.staffOnly || canAccessOperationsWorkspace(role),
  );

  return (
    <nav
      aria-label="주요 메뉴"
      className={`app-primary-navigation theme-surface-glass fixed inset-x-2 z-40 mx-auto max-w-[28rem] rounded-xl border p-1 md:static md:max-w-3xl md:rounded-xl md:shadow-sm ${className}`}
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
            item.value === "profile" && isOwnerRole(role)
              ? "관리자 메뉴"
              : item.value === "admin" && role === "employee"
              ? "업무 도구"
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
                if (!isLocked) onNavigate(item.value);
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
  );
}
