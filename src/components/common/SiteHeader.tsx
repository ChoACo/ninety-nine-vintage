"use client";

import type { Role } from "@/src/types/auction";
import Button from "./Button";
import RoleToggle from "./RoleToggle";

export interface SiteHeaderProps {
  role: Role;
  onRoleChange: (role: Role) => void;
  onCreateAuction?: () => void;
}

export default function SiteHeader({
  role,
  onRoleChange,
  onCreateAuction,
}: SiteHeaderProps) {
  return (
    <header className="rounded-[2rem] border border-white/80 bg-[#fffaf3]/90 p-4 shadow-[0_14px_40px_rgba(101,75,54,0.1)] backdrop-blur sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="grid h-12 w-12 shrink-0 rotate-[-3deg] place-items-center rounded-[1.1rem] bg-[#ec7866] text-base font-black text-white shadow-[0_8px_20px_rgba(218,103,84,0.26)]"
          >
            다미
          </div>
          <div>
            <p className="text-xs font-bold tracking-[0.18em] text-[#b56959]">
              TRUSTED VINTAGE CLOTHING AUCTION
            </p>
            <h1 className="mt-0.5 text-xl font-black tracking-[-0.04em] text-[#3e342e] sm:text-2xl">
              다미네 구제
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <span className="rounded-full bg-[#e7f2f5] px-3 py-1.5 text-sm font-bold text-[#467481]">
            임시 권한 테스트
          </span>
          <RoleToggle role={role} onToggle={onRoleChange} compact />
          {role === "admin" && onCreateAuction ? (
            <Button onClick={onCreateAuction} size="sm" className="ml-auto sm:ml-0">
              <span aria-hidden="true">+</span> 경매글 작성
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
