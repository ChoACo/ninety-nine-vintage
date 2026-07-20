"use client";

import { Headphones, Menu, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CommerceToolbar } from "@/components/features/commerce/CommerceToolbar";
import { AuthStatus } from "@/components/layout/AuthStatus";

const navigation = [
  { label: "HOME", href: "/home" },
  { label: "LIVE AUCTION", href: "/feed" },
  { label: "BUY NOW", href: "/shop" },
  { label: "ARCHIVE", href: "/sold" },
];

export function PcHeader() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  return (
    <header className="sticky top-9 z-[60] border-b border-line bg-paper/95 text-ink md:backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1680px] items-center justify-between gap-4 px-4 sm:px-6 md:h-20 md:px-8 lg:px-10 xl:px-12">
        <button aria-label="메뉴 열기" className="grid size-10 place-items-center border border-line lg:hidden" onClick={() => setOpen(true)} type="button"><Menu size={18} /></button>
        <Link className="min-w-0 shrink text-sm font-black tracking-[-0.06em] sm:text-base lg:w-[270px] lg:text-lg" href="/home">NINETY-NINE VINTAGE</Link>
        <nav className="hidden flex-1 items-center justify-center gap-6 lg:flex xl:gap-10" aria-label="주요 메뉴">
          {navigation.map((item) => <Link className="border-b-2 border-transparent py-2 text-xs font-bold tracking-[0.02em] transition-colors hover:border-ink lg:text-sm" href={item.href} key={item.href}>{item.label}</Link>)}
        </nav>
        <div className="flex shrink-0 items-center gap-2 lg:ml-4 lg:justify-end">
          <Link aria-label="상담" className="hidden size-10 shrink-0 place-items-center border border-line lg:grid" href="/chat"><Headphones size={17} /></Link>
          <span className="hidden lg:inline-flex"><AuthStatus /></span>
          <CommerceToolbar />
          <form className="hidden h-10 items-center gap-2 border border-line bg-surface px-3 text-muted lg:flex" onSubmit={(event) => { event.preventDefault(); const value = query.trim(); router.push(value ? `/shop?q=${encodeURIComponent(value)}` : "/shop"); }}><Search size={16} /><input aria-label="상품 검색" className="w-36 bg-transparent text-xs text-ink outline-none placeholder:text-muted" onChange={(event) => setQuery(event.target.value)} placeholder="검색 후 Enter" value={query} /></form>
        </div>
      </div>
      {open && <div className="fixed inset-0 z-50 bg-ink/30 lg:hidden" onClick={() => setOpen(false)}><aside className="h-full w-[min(86vw,340px)] overflow-y-auto bg-paper p-5" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between border-b border-line pb-5"><span className="text-xs font-bold tracking-[0.12em]">NINETY-NINE</span><button aria-label="메뉴 닫기" onClick={() => setOpen(false)} type="button"><X size={18} /></button></div><nav className="grid gap-1 py-5" aria-label="모바일 메뉴">{navigation.map((item) => <Link className="border-b border-line py-4 text-sm font-bold" href={item.href} key={item.href} onClick={() => setOpen(false)}>{item.label}</Link>)}<Link className="border-b border-line py-4 text-sm font-bold" href="/account" onClick={() => setOpen(false)}>MY ACCOUNT</Link><Link className="border-b border-line py-4 text-sm font-bold" href="/chat" onClick={() => setOpen(false)}>SUPPORT / CHAT</Link><Link className="border-b border-line py-4 text-sm font-bold" href="/operator" onClick={() => setOpen(false)}>OPERATOR</Link><Link className="border-b border-line py-4 text-sm font-bold" href="/owner" onClick={() => setOpen(false)}>OWNER</Link><a className="border-b border-line py-4 text-sm font-bold" href="/api/auth/kakao/start?returnTo=%2Faccount">KAKAO LOGIN</a><span className="pt-4 text-[10px] font-bold tracking-[0.12em] text-muted">POLICY</span><Link className="border-b border-line py-3 text-xs" href="/terms" onClick={() => setOpen(false)}>이용약관</Link><Link className="border-b border-line py-3 text-xs" href="/privacy" onClick={() => setOpen(false)}>개인정보처리방침</Link><Link className="py-3 text-xs" href="/refund" onClick={() => setOpen(false)}>환불·취소 정책</Link></nav></aside></div>}
    </header>
  );
}
