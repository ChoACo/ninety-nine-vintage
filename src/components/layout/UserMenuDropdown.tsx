"use client";

import { ChevronDown, LogOut, Package, PackageOpen, User } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { PremiumDialog } from "@/components/ui/PremiumDialog";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const MENU_ITEM_CLASS = "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-zinc-200 transition-all hover:bg-zinc-800/70 hover:text-white focus-visible:bg-zinc-800/70 focus-visible:text-white focus-visible:outline-none cursor-pointer select-none";

function maskIdentity(value: string) {
  const [local, domain] = value.split("@");
  if (!domain) return value.length > 8 ? `${value.slice(0, 6)}…` : value;
  return `${local.slice(0, 2)}${local.length > 2 ? "**" : ""}@${domain}`;
}

export function UserMenuDropdown({ basePath = "", session }: { basePath?: "" | "/m"; session: Session }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const fullIdentity = session.user.email
    ?? session.user.user_metadata?.nickname
    ?? session.user.user_metadata?.name
    ?? "로그인 회원";
  const visibleIdentity = maskIdentity(String(fullIdentity));
  const initials = String(session.user.user_metadata?.nickname ?? session.user.user_metadata?.name ?? fullIdentity)
    .trim()
    .slice(0, 2)
    .toUpperCase();
  const myHref = (tab?: "orders" | "vault") => basePath === "/m"
    ? `/m/my${tab ? `?tab=${tab}` : ""}`
    : tab ? `/my/${tab}` : "/my";

  const logout = async () => {
    if (logoutBusy) return;
    setLogoutBusy(true);
    await getSupabaseBrowserClient().auth.signOut();
    router.replace(`${basePath}/home`);
    router.refresh();
  };

  return <>
    <DropdownMenu.Root onOpenChange={setOpen} open={open}>
      <DropdownMenu.Trigger asChild>
        <button aria-label="사용자 메뉴" className="flex h-10 items-center gap-2 rounded-xl border border-line bg-paper px-2 pr-3 text-[11px] font-bold text-ink transition-colors hover:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2" type="button">
          <span aria-hidden="true" className="grid size-7 place-items-center rounded-full bg-zinc-200 text-[10px] font-bold text-zinc-900">{initials}</span>
          <span className="max-w-28 truncate">{visibleIdentity}</span>
          <ChevronDown className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} size={14} strokeWidth={1.75} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" aria-label="사용자 메뉴" className="z-[100] w-64 rounded-2xl border border-zinc-800 bg-zinc-900/95 p-2 text-zinc-100 shadow-2xl backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95" sideOffset={8}>
          <DropdownMenu.Label className="truncate border-b border-zinc-800 px-3 py-2.5 text-[11px] font-normal text-zinc-400" title={String(fullIdentity)}>{fullIdentity}</DropdownMenu.Label>
          <DropdownMenu.Group className="py-1.5">
            <DropdownMenu.Item asChild><Link className={MENU_ITEM_CLASS} href={myHref()}><User size={17} strokeWidth={1.75} /> 내 정보</Link></DropdownMenu.Item>
            <DropdownMenu.Item asChild><Link className={MENU_ITEM_CLASS} href={myHref("orders")}><Package size={17} strokeWidth={1.75} /> 주문·배송</Link></DropdownMenu.Item>
            <DropdownMenu.Item asChild><Link className={MENU_ITEM_CLASS} href={myHref("vault")}><PackageOpen size={17} strokeWidth={1.75} /> 보관함</Link></DropdownMenu.Item>
          </DropdownMenu.Group>
          <DropdownMenu.Separator className="my-1.5 h-px bg-zinc-800" />
          <DropdownMenu.Item asChild><button className={`${MENU_ITEM_CLASS} text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 focus-visible:bg-rose-500/10 focus-visible:text-rose-300`} onClick={() => setLogoutOpen(true)} type="button"><LogOut size={17} strokeWidth={1.75} /> 로그아웃</button></DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    <PremiumDialog closeDisabled={logoutBusy} labelledBy="gnb-logout-title" onClose={() => setLogoutOpen(false)} open={logoutOpen} panelClassName="max-w-md">
      <div className="p-6">
        <h2 className="text-xl font-black" id="gnb-logout-title">로그아웃하시겠습니까?</h2>
        <p className="mt-3 text-sm leading-6 text-muted">진행 중인 결제나 배송 신청이 있다면 먼저 확인해 주세요.</p>
        <div className="mt-6 grid grid-cols-2 gap-2">
          <button className="min-h-11 rounded-xl border border-line text-xs font-bold" disabled={logoutBusy} onClick={() => setLogoutOpen(false)} type="button">취소</button>
          <button className="min-h-11 rounded-xl bg-rose-700 text-xs font-bold text-white disabled:opacity-50" disabled={logoutBusy} onClick={() => void logout()} type="button">{logoutBusy ? "로그아웃 중…" : "로그아웃"}</button>
        </div>
      </div>
    </PremiumDialog>
  </>;
}
