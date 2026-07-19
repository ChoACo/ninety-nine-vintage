"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type FormEvent } from "react";

import { AuthModal } from "@/src/components/auth";
import { useAuthSession } from "@/src/hooks/useAuthSession";
import { useAuctionClock } from "@/src/hooks/useAuctionClock";
import {
  canAccessOperationsWorkspace,
  isOwnerRole,
  type AppRole,
} from "@/src/lib/supabase/auth";
import { getDailyAuctionPhase } from "@/src/utils/auctionBidPolicy";
import { formatCountdown } from "@/src/utils/formatters";
import BusinessFooter from "./BusinessFooter";
import Button from "./Button";
import ThemeToggle from "./ThemeToggle";

const navigation = [
  { href: "/home", label: "HOME" },
  { href: "/feed", label: "LIVE AUCTION" },
  { href: "/shop", label: "BUY NOW" },
  { href: "/sold", label: "ARCHIVE" },
] as const;

function HeaderIcon({ kind }: { kind: "chat" | "user" | "settings" | "search" }) {
  const path = kind === "chat"
    ? "M4 5.5h16v10H9l-5 4v-14Z"
    : kind === "user"
      ? "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7.5 8c.7-4 3.2-6 7.5-6s6.8 2 7.5 6"
      : kind === "settings"
        ? "M4 7h10m3 0h3M4 12h3m3 0h10M4 17h8m3 0h5M14 4v6M7 9v6m5 1v4"
        : "m20 20-4.6-4.6M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4Z";
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="size-[17px]"><path d={path} /></svg>;
}

function LiveTicker() {
  const { currentTime, countdown } = useAuctionClock({ rollover: true });
  const isClosed = getDailyAuctionPhase(currentTime) === "closed";
  return (
    <div className="editorial-ticker sticky top-0 z-[70] h-9 border-b border-white/10 bg-zinc-950 text-white">
      <div className="mx-auto flex h-full max-w-[1680px] items-center justify-between px-10 text-xs">
        <div className="flex items-center gap-2 font-black tracking-[0.12em]"><span aria-hidden="true" className={`size-1.5 rounded-full ${isClosed ? "bg-zinc-500" : "bg-emerald-400"}`} />NINETY-NINE · LIVE DROP <span className="font-medium tracking-normal text-zinc-400">오늘의 빈티지 경매 · 21:00 KST 마감</span></div>
        <span className="font-mono text-xs font-bold tabular-nums tracking-tight text-zinc-200">{isClosed ? "22:00 재개" : formatCountdown(countdown)}</span>
      </div>
    </div>
  );
}

function Header({ role, authenticated, displayName, onOpenAuth, onSignOut, signingOut }: {
  role: AppRole;
  authenticated: boolean;
  displayName: string;
  onOpenAuth: () => void;
  onSignOut: () => void | Promise<void>;
  signingOut: boolean;
}) {
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState("");
  const operationsVisible = canAccessOperationsWorkspace(role);
  const owner = isOwnerRole(role);
  const utilityPath = owner ? "/owner" : operationsVisible ? "/operator" : "/account";
  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = searchQuery.trim().slice(0, 80);
    const query = value ? `?q=${encodeURIComponent(value)}` : "";
    window.location.assign(`/feed${query}`);
  };

  return (
    <header className="editorial-header sticky top-9 z-50 border-b border-[var(--border)] bg-[var(--surface)]/95 text-[var(--text-strong)] backdrop-blur-xl">
      <div className="mx-auto grid min-h-20 max-w-[1680px] grid-cols-[270px_minmax(0,1fr)_270px] items-center gap-4 px-10">
        <Link href="/home" aria-label="나인티 나인 빈티지 홈" className="w-fit border-l-2 border-[var(--text-strong)] pl-4"><span className="block text-[10px] font-black tracking-[0.22em] text-[var(--text-muted)]">NINETY-NINE</span><span className="block text-lg font-black tracking-[-0.05em]">VINTAGE</span></Link>
        <nav aria-label="주요 메뉴" className="flex items-center justify-center gap-10">
          {navigation.map((item) => { const active = item.href === "/home" ? pathname === "/" || pathname === "/home" : pathname === item.href || pathname.startsWith(item.href); return <Link key={item.href} href={item.href} prefetch={false} aria-current={active ? "page" : undefined} className={`border-b-2 py-3 text-sm font-black tracking-[0.02em] transition-colors ${active ? "border-[var(--text-strong)] text-[var(--text-strong)]" : "border-transparent text-[var(--text-muted)] hover:border-[var(--text-strong)] hover:text-[var(--text-strong)]"}`}>{item.label}</Link>; })}
        </nav>
        <div className="flex items-center justify-end gap-2">
          <Link href="/chat" aria-label="상담" className="grid size-10 place-items-center border border-[var(--border)] transition-colors hover:border-[var(--text-strong)]"><HeaderIcon kind="chat" /></Link>
          <Link href={utilityPath} aria-label={owner ? "owner 관제" : operationsVisible ? "운영 센터" : "내 정보"} className="grid size-10 place-items-center border border-[var(--border)] transition-colors hover:border-[var(--text-strong)]"><HeaderIcon kind={owner || operationsVisible ? "settings" : "user"} /></Link>
          <form onSubmit={submitSearch} role="search" className="flex h-10 w-36 items-center gap-2 border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 text-[var(--text-muted)] transition-colors focus-within:border-[var(--text-strong)]"><HeaderIcon kind="search" /><input aria-label="상품 검색" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value.slice(0, 80))} className="w-full min-w-0 bg-transparent text-xs font-bold outline-none placeholder:text-[var(--text-muted)]" placeholder="상품 검색" /></form>
          <ThemeToggle />
          {!authenticated ? <Button size="sm" className="whitespace-nowrap px-3" onClick={onOpenAuth}>카카오 시작</Button> : <Button size="sm" variant="ghost" className="max-w-[140px] truncate px-3" isLoading={signingOut} onClick={() => void onSignOut()}>{signingOut ? "처리 중" : (displayName ? `${displayName} · 로그아웃` : "로그아웃")}</Button>}
        </div>
      </div>
    </header>
  );
}

export function EditorialChrome({ children }: { children: React.ReactNode }) {
  const auth = useAuthSession();
  const [authOpen, setAuthOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const signOut = async () => { setSigningOut(true); try { await auth.signOut(); } finally { setSigningOut(false); } };
  return <div className="editorial-site min-h-screen min-w-[1200px] bg-[var(--background)] text-[var(--text-strong)]"><LiveTicker /><Header role={auth.role} authenticated={Boolean(auth.user)} displayName={auth.profile?.displayName ?? ""} onOpenAuth={() => setAuthOpen(true)} onSignOut={signOut} signingOut={signingOut} /><div className="editorial-content">{children}</div><BusinessFooter />{authOpen ? <AuthModal open onClose={() => setAuthOpen(false)} /> : null}</div>;
}
