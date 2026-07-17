"use client";

import {
  canAccessOperationsCenter,
  canAccessOperationsWorkspace,
  isMemberRole,
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
  icon: string;
  staffOnly?: boolean;
}> = [
  { value: "feed", label: "경매 피드", icon: "⌂" },
  { value: "chat", label: "채팅", icon: "○" },
  { value: "profile", label: "내 정보", icon: "☺" },
  { value: "admin", label: "운영 센터", icon: "⚙", staffOnly: true },
];

export default function Navigation({
  activePage,
  onNavigate,
  role,
  className = "",
}: NavigationProps) {
  return (
    <nav
      aria-label="주요 메뉴"
      className={`theme-surface-glass fixed inset-x-3 bottom-3 z-40 mx-auto max-w-xl rounded-[1.4rem] border p-1.5 backdrop-blur-xl md:static md:max-w-none md:shadow-sm ${className}`}
    >
      <div className="grid grid-cols-4 gap-1">
        {navigationItems.map((item) => {
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
              : item.value === "chat" && canAccessOperationsCenter(role)
              ? "상담 대화함"
              : item.label;

          return (
            <button
              key={item.value}
              type="button"
              aria-current={selected ? "page" : undefined}
              aria-label={
                isLocked
                  ? `${visibleLabel}, 허용된 운영 역할에서 이용 가능`
                  : visibleLabel
              }
              onClick={() => {
                if (!isLocked) onNavigate(item.value);
              }}
              className={`group relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl px-2 py-1.5 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#eb7765] sm:flex-row sm:gap-2 sm:text-base ${
                selected
                  ? "bg-[var(--accent-surface)] text-[var(--accent-text)] shadow-sm"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-strong)]"
              }`}
            >
              <span
                aria-hidden="true"
                className={`text-lg leading-none ${selected ? "scale-105" : "opacity-75"}`}
              >
                {item.icon}
              </span>
              <span className="whitespace-nowrap">{visibleLabel}</span>
              {isLocked ? (
                <span
                  aria-hidden="true"
                  className="absolute ml-9 -mt-7 rounded-full bg-[var(--surface-muted)] px-1 text-[9px] text-[var(--text-muted)] sm:relative sm:ml-0 sm:mt-0"
                >
                  잠금
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
