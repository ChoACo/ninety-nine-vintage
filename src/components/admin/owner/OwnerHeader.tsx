"use client";

import Link from "next/link";
import { AlertTriangle, Command, Database, Search, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useOwnerScopeStore } from "@/store/useOwnerScopeStore";

const commands = [
  ["플랫폼 대시보드", "/admin/owner"], ["판매센터 관리", "/admin/owner/stores"], ["회원·권한", "/admin/owner/members"],
  ["입금 확인", "/admin/owner/payments"], ["통합 정산", "/admin/owner/platform"], ["감사 로그", "/admin/owner/site-status"],
] as const;

export function OwnerHeader() {
  const { selectedStoreId, setSelectedStoreId, setStores, stores } = useOwnerScopeStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [health, setHealth] = useState({ db: false, sessions: 0, tokens: 0, storage: 0 });
  const filtered = useMemo(() => commands.filter(([label]) => label.includes(query.trim())), [query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen(true); }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
      if (!session) return;
      const headers = { Authorization: `Bearer ${session.access_token}` };
      const [overview, tokenUsage, storageUsage] = await Promise.allSettled([
        fetch("/api/admin/owner/overview", { headers, cache: "no-store" }).then((response) => response.json()),
        fetch("/api/admin/owner/token-usage", { headers, cache: "no-store" }).then((response) => response.json()),
        fetch("/api/admin/owner/storage-usage", { headers, cache: "no-store" }).then((response) => response.json()),
      ]);
      if (cancelled) return;
      const overviewData = overview.status === "fulfilled" ? overview.value as { stores?: Array<{ id: string; name: string; slug: string }>; activeSessions?: number; dbConnected?: boolean } : {};
      const tokenData = tokenUsage.status === "fulfilled" ? tokenUsage.value as { totalTokens?: number } : {};
      const storageData = storageUsage.status === "fulfilled" ? storageUsage.value as { ratio?: number } : {};
      setStores(overviewData.stores ?? []);
      setHealth({ db: overviewData.dbConnected === true, sessions: overviewData.activeSessions ?? 0, tokens: Math.min(100, Math.round(((tokenData.totalTokens ?? 0) / 1_000_000) * 100)), storage: Math.min(100, Math.round((storageData.ratio ?? 0) * 100)) });
    })();
    return () => { cancelled = true; };
  }, [setStores]);

  return <>
    <div className="mb-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-3 text-zinc-100 shadow-xl shadow-black/10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-w-[240px] flex-1 items-center gap-2 text-xs font-black"><ShieldCheck className="text-amber-400" size={16} /><select aria-label="소유자 전역 센터 범위" className="h-11 min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-100 outline-none focus:border-amber-500" onChange={(event) => setSelectedStoreId(event.target.value || null)} value={selectedStoreId ?? ""}><option value="">🌐 전체 플랫폼 통합 뷰</option>{stores.map((store) => <option key={store.id} value={store.id}>🏬 {store.name}</option>)}</select></label>
        <div className="flex items-center gap-2"><span className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-[10px] font-black ${health.db ? "border-emerald-500/30 text-emerald-400" : "border-rose-500/30 text-rose-400"}`}><span className={`size-2 rounded-full ${health.db ? "animate-pulse bg-emerald-400" : "bg-rose-500"}`} /><Database size={13} /> DB·Realtime</span><span className="hidden min-h-11 items-center rounded-xl border border-zinc-800 px-3 font-mono text-[10px] text-zinc-400 md:inline-flex">CCU {health.sessions}</span><Link className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-500/30 px-3 text-xs font-black text-rose-400 hover:bg-rose-500/10" href="/admin/owner/rules/auction"><AlertTriangle size={14}/>비상 제어</Link><button aria-expanded={open} aria-haspopup="dialog" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-700 px-3 text-xs font-bold" onClick={() => setOpen(true)} type="button"><Search size={14} /><Command size={11} />K</button></div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2"><Quota label="AI token" value={health.tokens} /><Quota label="Storage" value={health.storage} /></div>
    </div>
    {open && <div aria-modal="true" className="fixed inset-0 z-[130] grid place-items-start bg-black/70 p-4 pt-[12vh] backdrop-blur-sm" onClick={() => setOpen(false)} role="dialog"><div className="w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 text-zinc-100" onClick={(event) => event.stopPropagation()}><div className="flex items-center gap-3 border-b border-zinc-800 px-4"><Search size={16} /><input autoFocus className="h-14 min-w-0 flex-1 bg-transparent text-sm outline-none" onChange={(event) => setQuery(event.target.value)} placeholder="회원·매장·주문·감사 메뉴 검색" value={query} /></div><div className="grid gap-1 p-2">{filtered.map(([label, href]) => <Link className="flex min-h-11 items-center rounded-xl px-3 text-sm font-bold hover:bg-zinc-800 hover:text-amber-400" href={href} key={href} onClick={() => setOpen(false)}>{label}</Link>)}</div></div></div>}
  </>;
}

function Quota({ label, value }: Readonly<{ label: string; value: number }>) { return <div className="flex items-center gap-3"><span className="w-16 text-[9px] font-bold uppercase tracking-wider text-zinc-500">{label}</span><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800"><div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${value}%` }} /></div><span className="w-8 text-right font-mono text-[9px] text-zinc-500">{value}%</span></div>; }
