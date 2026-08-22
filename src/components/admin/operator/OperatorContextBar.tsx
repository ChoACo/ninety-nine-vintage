"use client";

import Link from "next/link";
import { Command, Search, Store, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useOperatorStoreScope } from "@/store/useOperatorStoreScope";

const commands = [
  ["대시보드", "/admin/operator"],
  ["상품 목록", "/admin/operator/products"],
  ["새 상품 등록", "/admin/operator/products/new"],
  ["경매 모니터", "/admin/operator/auctions"],
  ["묶음 출고", "/admin/operator/shipping"],
  ["고객 문의", "/admin/operator/inquiries"],
] as const;

const routeHeadings = [
  { exact: true, path: "/admin/operator/products/new", title: "새 상품 등록", breadcrumb: ["운영자 센터", "상품 관리", "새 상품 등록"] },
  { exact: true, path: "/admin/operator/products", title: "상품 목록", breadcrumb: ["운영자 센터", "상품 관리", "목록"] },
  { exact: true, path: "/admin/operator/sales", title: "매출 분석", breadcrumb: ["운영자 센터", "매출 분석"] },
  { exact: false, path: "/admin/operator/auctions", title: "실시간 경매 운영", breadcrumb: ["운영자 센터", "경매 운영"] },
  { exact: false, path: "/admin/operator/orders", title: "판매·주문", breadcrumb: ["운영자 센터", "판매·주문"] },
  { exact: false, path: "/admin/operator/shipping", title: "보관함·출고 관리", breadcrumb: ["운영자 센터", "보관함·출고"] },
] as const;

export function getOperatorPageHeading(pathname: string) {
  return routeHeadings.find((item) => item.exact ? pathname === item.path : pathname === item.path || pathname.startsWith(`${item.path}/`))
    ?? { title: "운영 관리", breadcrumb: ["운영자 센터"] as readonly string[] };
}

export function OperatorContextBar() {
  const { scope, stores } = useOperatorStoreScope();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const storeName = stores.find((store) => store.id === scope.storeId)?.name ?? (scope.active ? "담당 매장" : "매장 범위 확인 중");
  const isAuction = pathname.includes("auction");
  const pageHeading = getOperatorPageHeading(pathname);
  const filtered = commands.filter(([label]) => label.includes(query.trim()));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return <>
    <div className="mb-4 rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-zinc-100 shadow-xl shadow-zinc-950/10">
      <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-zinc-800 text-amber-400"><Store size={17} strokeWidth={1.75} /></span>
        <div className="min-w-0"><p className="truncate text-sm font-black">{storeName}</p><p className="mt-0.5 text-[10px] text-zinc-500">운영자 고정 매장 범위</p></div>
        <span className="hidden items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-black text-emerald-400 sm:inline-flex"><span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />{isAuction ? "경매중" : "영업중"}</span>
      </div>
      <div className="flex items-center gap-2">
        <button aria-expanded={open} aria-haspopup="dialog" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-700 px-3 text-xs font-bold text-zinc-300 transition hover:border-zinc-400 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-amber-500" onClick={() => setOpen(true)} type="button"><Search size={15} /> <span className="hidden sm:inline">빠른 이동</span><kbd className="hidden rounded border border-zinc-700 px-1.5 py-0.5 text-[9px] text-zinc-500 sm:inline-flex"><Command size={10} />K</kbd></button>
        <Link className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-500 px-3 text-xs font-black text-zinc-950 transition hover:bg-amber-400 focus-visible:ring-2 focus-visible:ring-amber-500" href="/admin/operator/products/new"><Zap size={15} /> <span className="hidden sm:inline">새 상품 등록</span><span className="sm:hidden">등록</span></Link>
      </div>
      </div>
      <div className="mt-3 border-t border-zinc-800 pt-3">
        <nav aria-label="현재 위치" className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold text-zinc-500">{pageHeading.breadcrumb.map((label, index) => <span className="flex items-center gap-1.5" key={`${label}-${index}`}>{index > 0 ? <span aria-hidden="true">/</span> : null}<span aria-current={index === pageHeading.breadcrumb.length - 1 ? "page" : undefined}>{label}</span></span>)}</nav>
        <p className="mt-1 text-lg font-black text-zinc-100">{pageHeading.title}</p>
      </div>
    </div>
    {open && <div aria-label="운영자 빠른 이동" aria-modal="true" className="fixed inset-0 z-[120] grid place-items-start bg-zinc-950/70 p-4 pt-[12vh] backdrop-blur-sm" role="dialog" onClick={() => setOpen(false)}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 text-zinc-100 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4"><Search className="text-zinc-500" size={17} /><input autoFocus className="h-14 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-600" onChange={(event) => setQuery(event.target.value)} placeholder="메뉴를 검색하세요…" value={query} /><kbd className="text-[10px] text-zinc-500">ESC</kbd></div>
        <div className="grid gap-1 p-2">{filtered.map(([label, href]) => <Link className="flex min-h-11 items-center rounded-xl px-3 text-sm font-bold transition hover:bg-zinc-800 hover:text-amber-400" href={href} key={href} onClick={() => setOpen(false)}>{label}<span className="ml-auto text-[10px] text-zinc-600">{href}</span></Link>)}{filtered.length === 0 && <p className="px-3 py-8 text-center text-xs text-zinc-500">일치하는 메뉴가 없습니다.</p>}</div>
      </div>
    </div>}
  </>;
}
