"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import { AuthModal } from "@/src/components/auth";
import ThemeToggle from "@/src/components/common/ThemeToggle";
import { useAuthSession } from "@/src/hooks/useAuthSession";
import {
  canAccessOperationsWorkspace,
  isOwnerRole,
  type AppRole,
} from "@/src/lib/supabase/auth";
import { getDailyAuctionPhase } from "@/src/utils/auctionBidPolicy";
import { formatCountdown } from "@/src/utils/formatters";
import { useAuctionClock } from "@/src/hooks/useAuctionClock";

const primaryNavigation = [
  { href: "/home", label: "HOME", index: "01" },
  { href: "/feed", label: "LIVE AUCTION", index: "02" },
  { href: "/shop", label: "BUY NOW", index: "03" },
  { href: "/sold", label: "ARCHIVE", index: "04" },
] as const;

function Icon({ name }: { name: "search" | "chat" | "account" | "workspace" }) {
  const paths = {
    search: "m20 20-4.7-4.7m1.7-5.1a6.8 6.8 0 1 1-13.6 0 6.8 6.8 0 0 1 13.6 0Z",
    chat: "M4 5.5h16v10H9l-5 4v-14Z",
    account: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7.5 8c.7-4 3.2-6 7.5-6s6.8 2 7.5 6",
    workspace: "M5 5h14v14H5zM9 5v14M5 10h14",
  } as const;
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="size-4"><path d={paths[name]} /></svg>;
}

function isRouteActive(href: string, pathname: string) {
  return href === "/home"
    ? pathname === "/" || pathname === "/home"
    : pathname === href || pathname.startsWith(`${href}/`);
}

function LiveRibbon() {
  const { currentTime, countdown } = useAuctionClock({ rollover: true });
  const closed = getDailyAuctionPhase(currentTime) === "closed";

  return (
    <div className="nn-ribbon sticky top-0 z-[80] h-9 bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex h-full max-w-[1760px] items-center justify-between px-10">
        <p className="flex items-center gap-2 text-[10px] font-black tracking-[0.16em]">
          <span aria-hidden="true" className={`size-1.5 rounded-full ${closed ? "bg-zinc-500" : "bg-emerald-400"}`} />
          NINETY-NINE / LIVE DROP
          <span className="font-medium tracking-normal text-zinc-400">오늘의 빈티지 경매 · 21:00 KST 마감</span>
        </p>
        <time className="font-mono text-xs font-black tabular-nums tracking-tight">{closed ? "22:00 재개" : formatCountdown(countdown)}</time>
      </div>
    </div>
  );
}

function Header({
  authenticated,
  displayName,
  role,
  signingOut,
  onOpenAuth,
  onSignOut,
}: {
  authenticated: boolean;
  displayName: string;
  role: AppRole;
  signingOut: boolean;
  onOpenAuth: () => void;
  onSignOut: () => void | Promise<void>;
}) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const workspaceHref = isOwnerRole(role)
    ? "/owner"
    : canAccessOperationsWorkspace(role)
      ? "/operator"
      : "/account";

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = query.trim().slice(0, 80);
    window.location.assign(value ? `/feed?q=${encodeURIComponent(value)}` : "/feed");
  };

  return (
    <header className="nn-header sticky top-9 z-[70] border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur-xl">
      <div className="mx-auto grid h-[88px] max-w-[1760px] grid-cols-[260px_minmax(0,1fr)_360px] items-center gap-8 px-10">
        <Link href="/home" aria-label="나인티 나인 빈티지 홈" className="group flex w-fit items-center gap-3.5">
          <span className="h-11 w-1 bg-[var(--text-strong)] transition-transform duration-200 group-hover:scale-y-110" />
          <span>
            <span className="block text-[9px] font-black tracking-[0.26em] text-[var(--text-muted)]">NINETY-NINE</span>
            <span className="mt-0.5 block text-[19px] font-black leading-none tracking-[-0.07em] text-[var(--text-strong)]">VINTAGE</span>
          </span>
        </Link>

        <nav aria-label="주요 메뉴" className="flex h-full items-center justify-center gap-1">
          {primaryNavigation.map((item) => {
            const active = isRouteActive(item.href, pathname);
            return (
              <Link key={item.href} href={item.href} prefetch={false} aria-current={active ? "page" : undefined} className={`group relative flex h-full items-center gap-2 px-5 text-[12px] font-black tracking-[0.035em] transition-colors ${active ? "text-[var(--text-strong)]" : "text-[var(--text-muted)] hover:text-[var(--text-strong)]"}`}>
                <span className="font-mono text-[9px] tabular-nums text-[var(--text-muted)]">{item.index}</span>
                {item.label}
                <span aria-hidden="true" className={`absolute inset-x-5 bottom-0 h-0.5 origin-left bg-[var(--text-strong)] transition-transform duration-200 ${active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100"}`} />
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center justify-end gap-2">
          <form onSubmit={submitSearch} role="search" className="flex h-10 w-36 items-center gap-2 border-b border-[var(--border-strong)] px-1 text-[var(--text-muted)] transition-colors focus-within:border-[var(--text-strong)]">
            <Icon name="search" />
            <input aria-label="상품 검색" value={query} onChange={(event) => setQuery(event.target.value.slice(0, 80))} placeholder="상품 검색" className="min-w-0 flex-1 bg-transparent text-xs font-bold outline-none placeholder:text-[var(--text-muted)]" />
          </form>
          <Link href="/chat" aria-label="상담" className="grid size-10 place-items-center border border-[var(--border)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--text-strong)]"><Icon name="chat" /></Link>
          <Link href={workspaceHref} aria-label={workspaceHref === "/account" ? "내 정보" : "운영 워크스페이스"} className="grid size-10 place-items-center border border-[var(--border)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--text-strong)]"><Icon name={workspaceHref === "/account" ? "account" : "workspace"} /></Link>
          <ThemeToggle />
          {authenticated ? (
            <button type="button" onClick={() => void onSignOut()} disabled={signingOut} className="h-10 max-w-[148px] truncate bg-[var(--text-strong)] px-4 text-[11px] font-black text-[var(--surface)] transition-all duration-200 hover:scale-[1.02] disabled:opacity-55">
              {signingOut ? "처리 중" : `${displayName || "회원"} · 로그아웃`}
            </button>
          ) : (
            <button type="button" onClick={onOpenAuth} className="h-10 bg-[var(--text-strong)] px-4 text-[11px] font-black text-[var(--surface)] transition-all duration-200 hover:scale-[1.02]">카카오 시작</button>
          )}
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-20 border-t border-[var(--text-strong)] bg-[var(--surface)]">
      <div className="mx-auto grid max-w-[1760px] grid-cols-[1.4fr_repeat(3,minmax(0,1fr))] gap-10 px-10 py-12">
        <div>
          <p className="text-[11px] font-black tracking-[0.2em]">NINETY-NINE VINTAGE</p>
          <p className="mt-4 max-w-sm text-sm font-medium leading-6 text-[var(--text-muted)]">시간을 다시 입는 빈티지 셀렉션. 투명한 라이브 경매와 한 점 한 점의 정가 구매를 운영합니다.</p>
          <p className="mt-7 font-mono text-[10px] font-bold tabular-nums text-[var(--text-muted)]">© 2026 NINETY-NINE VINTAGE</p>
        </div>
        <div><p className="text-[10px] font-black tracking-[0.16em] text-[var(--text-muted)]">SHOP</p><div className="mt-4 grid gap-2 text-sm font-bold"><Link href="/feed">LIVE AUCTION</Link><Link href="/shop">BUY NOW</Link><Link href="/sold">SOLD ARCHIVE</Link></div></div>
        <div><p className="text-[10px] font-black tracking-[0.16em] text-[var(--text-muted)]">SUPPORT</p><div className="mt-4 grid gap-2 text-sm font-bold"><Link href="/chat">상담·문의</Link><Link href="/terms">이용약관</Link><Link href="/privacy">개인정보처리방침</Link><Link href="/refund">취소·환불 정책</Link></div></div>
        <div><p className="text-[10px] font-black tracking-[0.16em] text-[var(--text-muted)]">CONTACT</p><p className="mt-4 text-sm font-black">0507-1494-3519</p><p className="mt-2 text-sm font-bold text-[var(--text-muted)]">ninety-nine@kakao.com</p><details className="mt-5 text-xs text-[var(--text-muted)]"><summary className="cursor-pointer font-black text-[var(--text-strong)]">사업자 정보</summary><p className="mt-3 leading-5">나인티 나인 빈티지 · 이영준<br />사업자등록번호 875-07-03297<br />부산광역시 수영구 수미로50번길 37-1, 1층</p></details></div>
      </div>
    </footer>
  );
}

export function CommerceShell({ children }: { children: ReactNode }) {
  const auth = useAuthSession();
  const [authOpen, setAuthOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const displayName = isOwnerRole(auth.role) ? "" : (auth.profile?.displayName ?? "");

  const signOut = async () => {
    setSigningOut(true);
    try {
      await auth.signOut();
      window.location.assign("/home");
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="nn-site min-h-screen min-w-[1200px] bg-[var(--background)] text-[var(--text-strong)]">
      <LiveRibbon />
      <Header role={auth.role} authenticated={Boolean(auth.user)} displayName={displayName} signingOut={signingOut} onOpenAuth={() => setAuthOpen(true)} onSignOut={signOut} />
      <div className="nn-page relative">{children}</div>
      <Footer />
      {authOpen ? <AuthModal open onClose={() => setAuthOpen(false)} /> : null}
    </div>
  );
}
