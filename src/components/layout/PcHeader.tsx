"use client";

import { Headphones, Menu, Search, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CommerceToolbar } from "@/components/features/commerce/CommerceToolbar";

const navigation = [
  { label: "HOME", href: "/" },
  { label: "LIVE AUCTION", href: "/feed" },
  { label: "BUY NOW", href: "/shop" },
  { label: "ARCHIVE", href: "/sold" },
];

export function PcHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-9 z-40 border-b border-line bg-paper/95 text-ink backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1680px] items-center justify-between gap-4 px-4 sm:px-6 md:h-20 md:px-8 lg:px-10 xl:px-12">
        <button aria-label="메뉴 열기" className="grid size-10 place-items-center border border-line md:hidden" onClick={() => setOpen(true)} type="button"><Menu size={18} /></button>
        <Link className="shrink-0 text-sm font-black tracking-[-0.06em] sm:text-base md:w-[270px] lg:text-lg" href="/">NINETY-NINE VINTAGE</Link>
        <nav className="hidden flex-1 items-center justify-center gap-6 md:flex lg:gap-10" aria-label="주요 메뉴">
          {navigation.map((item) => <Link className="border-b-2 border-transparent py-2 text-xs font-bold tracking-[0.02em] transition-colors hover:border-ink lg:text-sm" href={item.href} key={item.href}>{item.label}</Link>)}
        </nav>
        <div className="flex items-center gap-2 md:w-[270px] md:justify-end">
          <Link aria-label="상담" className="grid size-10 place-items-center border border-line" href="/chat"><Headphones size={17} /></Link>
          <Link aria-label="내 정보" className="grid size-10 place-items-center border border-line" href="/account"><UserRound size={17} /></Link>
          <CommerceToolbar />
          <label className="hidden h-10 items-center gap-2 border border-line bg-surface px-3 text-muted lg:flex"><Search size={16} /><input aria-label="상품 검색" className="w-36 bg-transparent text-xs text-ink outline-none placeholder:text-muted" placeholder="검색" /></label>
        </div>
      </div>
      {open && <div className="fixed inset-0 z-50 bg-ink/30 md:hidden" onClick={() => setOpen(false)}><aside className="h-full w-[min(86vw,340px)] bg-paper p-5" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between border-b border-line pb-5"><span className="text-xs font-bold tracking-[0.12em]">NINETY-NINE</span><button aria-label="메뉴 닫기" onClick={() => setOpen(false)} type="button"><X size={18} /></button></div><nav className="grid gap-1 py-5" aria-label="모바일 메뉴">{navigation.map((item) => <Link className="border-b border-line py-4 text-sm font-bold" href={item.href} key={item.href} onClick={() => setOpen(false)}>{item.label}</Link>)}<Link className="border-b border-line py-4 text-sm font-bold" href="/account">MY ACCOUNT</Link><Link className="border-b border-line py-4 text-sm font-bold" href="/chat">SUPPORT</Link></nav></aside></div>}
    </header>
  );
}
