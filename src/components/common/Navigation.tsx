"use client";

import type { Role } from "@/src/types/auction";

export type NavigationTarget = "feed" | "chat" | "profile" | "admin";

export interface NavigationProps {
  activePage: NavigationTarget;
  onNavigate: (page: NavigationTarget) => void;
  role: Role;
  className?: string;
}

const navigationItems: Array<{
  value: NavigationTarget;
  label: string;
  icon: string;
  adminOnly?: boolean;
}> = [
  { value: "feed", label: "경매 피드", icon: "⌂" },
  { value: "chat", label: "채팅", icon: "○" },
  { value: "profile", label: "내 정보", icon: "☺" },
  { value: "admin", label: "관리자", icon: "⚙", adminOnly: true },
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
      className={`fixed inset-x-3 bottom-3 z-40 mx-auto max-w-xl rounded-[1.4rem] border border-white/80 bg-[#fffaf4]/95 p-1.5 shadow-[0_12px_40px_rgba(87,67,53,0.18)] backdrop-blur-xl md:static md:max-w-none md:bg-white/70 md:shadow-sm ${className}`}
    >
      <div className="grid grid-cols-4 gap-1">
        {navigationItems.map((item) => {
          const selected = activePage === item.value;
          const isLocked = item.adminOnly && role !== "admin";
          const visibleLabel =
            item.value === "chat" && (role === "operator" || role === "admin")
              ? "상담 대화함"
              : item.label;

          return (
            <button
              key={item.value}
              type="button"
              aria-current={selected ? "page" : undefined}
              aria-label={
                isLocked
                  ? `${visibleLabel}, 관리자 계정에서 이용 가능`
                  : visibleLabel
              }
              onClick={() => onNavigate(item.value)}
              className={`group relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl px-2 py-1.5 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#eb7765] sm:flex-row sm:gap-2 sm:text-base ${
                selected
                  ? "bg-[#ffe3d8] text-[#b44c3f] shadow-sm"
                  : "text-[#79675d] hover:bg-[#f8eee5] hover:text-[#4e413a]"
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
                  className="absolute ml-9 -mt-7 rounded-full bg-[#eee4db] px-1 text-[9px] text-[#7f6f65] sm:relative sm:ml-0 sm:mt-0"
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
