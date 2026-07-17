"use client";

import type { Role } from "@/src/types/auction";

export interface RoleToggleProps {
  role: Role;
  onToggle: (role: Role) => void;
  compact?: boolean;
}

const roles: Array<{ value: Role; label: string; shortLabel: string }> = [
  { value: "user", label: "일반 사용자 모드", shortLabel: "일반" },
  { value: "admin", label: "운영자 모드", shortLabel: "운영자" },
];

export default function RoleToggle({
  role,
  onToggle,
  compact = false,
}: RoleToggleProps) {
  return (
    <div
      role="group"
      aria-label="임시 권한 모드 선택"
      className="inline-flex rounded-2xl border border-[#ead8c9] bg-[#f6eadf] p-1 shadow-inner"
    >
      {roles.map((item) => {
        const selected = role === item.value;

        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onToggle(item.value)}
            className={`min-h-9 rounded-xl px-3 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e77766] focus-visible:ring-offset-1 sm:text-sm ${
              selected
                ? "bg-white text-[#bd5546] shadow-sm"
                : "text-[#806c60] hover:text-[#55463e]"
            }`}
          >
            {compact ? item.shortLabel : item.label}
          </button>
        );
      })}
    </div>
  );
}
