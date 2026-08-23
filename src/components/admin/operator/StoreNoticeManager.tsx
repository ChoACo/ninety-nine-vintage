"use client";

import { Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { useToastStore } from "@/store/useToastStore";

interface NoticeStore {
  id: string;
  name: string;
  announcementText?: string;
  announcementEnabled?: boolean;
}

export function StoreNoticeManager() {
  const { session } = useSupabaseSession();
  const token = session?.access_token ?? null;
  const toast = useToastStore((state) => state.pushToast);
  const [store, setStore] = useState<NoticeStore | null>(null);
  const [text, setText] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const response = await fetch("/api/admin/operator/platform", { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json().catch(() => null) as { management?: { stores?: NoticeStore[] }; error?: string } | null;
    if (!response.ok) throw new Error(payload?.error ?? "매장 공지를 불러오지 못했습니다.");
    const next = payload?.management?.stores?.[0] ?? null;
    setStore(next);
    setText(next?.announcementText ?? "");
    setEnabled(next?.announcementEnabled ?? false);
  }, [token]);

  useEffect(() => {
    queueMicrotask(() => void load().catch((error) => toast("error", error instanceof Error ? error.message : "매장 공지를 불러오지 못했습니다.")));
  }, [load, toast]);

  const save = async () => {
    if (!token || !store || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/operator/platform", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "save_notice", storeId: store.id, announcementText: text, announcementEnabled: enabled }) });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "매장 공지를 저장하지 못했습니다.");
      toast("success", "매장 공지가 저장되었습니다.");
      await load();
    } catch (error) {
      toast("error", error instanceof Error ? error.message : "매장 공지를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return <section className="w-full max-w-full overflow-hidden break-keep rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-100 md:p-6">
    <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-emerald-400">Store notice</p><h1 className="mt-2 text-2xl font-black">매장 공지</h1><p className="mt-2 text-xs text-zinc-400">{store?.name ?? "소속 매장"}의 한 줄 공지를 편집합니다.</p></div><label className="grid min-h-11 min-w-11 cursor-pointer place-items-center rounded-xl border border-zinc-700"><input checked={enabled} className="size-5 accent-emerald-500" onChange={(event) => setEnabled(event.target.checked)} type="checkbox" /><span className="sr-only">공지 노출</span></label></div>
    <input className="mt-5 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 text-base outline-none focus:border-emerald-500 md:text-sm" maxLength={80} onChange={(event) => setText(event.target.value)} placeholder="한 줄 공지를 입력하세요" value={text} />
    <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-3"><p className="text-[10px] font-bold text-zinc-500">모바일 미리보기</p><div className={`mt-2 rounded-xl px-4 py-3 text-center text-xs font-bold ${enabled && text.trim() ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-500"}`}>{enabled && text.trim() ? text : "공지 배너 미노출"}</div></div>
    <button className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-xs font-black text-zinc-950 disabled:opacity-40 sm:w-auto" disabled={!store || busy || (enabled && !text.trim())} onClick={() => void save()} type="button"><Save size={15} />{busy ? "저장 중…" : "공지 저장"}</button>
  </section>;
}
