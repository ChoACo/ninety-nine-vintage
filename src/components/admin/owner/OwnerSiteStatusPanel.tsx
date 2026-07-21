"use client";

import { Activity, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type SiteStatus = "operational" | "maintenance" | "preparing";
interface SitePayload { status?: SiteStatus; message?: string; updatedAt?: string | null; dbConnected?: boolean; error?: string; }

export function OwnerSiteStatusPanel() {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<SiteStatus>("operational");
  const [message, setMessage] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [dbConnected, setDbConnected] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
        if (!session) { setNotice("소유자 계정으로 로그인해 주세요."); return; }
        setToken(session.access_token);
        const response = await fetch("/api/admin/owner/site-status", { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
        const payload = await response.json() as SitePayload;
        if (!response.ok) throw new Error(payload.error ?? "사이트 상태를 불러오지 못했습니다.");
        setStatus(payload.status ?? "operational"); setMessage(payload.message ?? ""); setUpdatedAt(payload.updatedAt ?? null); setDbConnected(payload.dbConnected === true);
      } catch (error) { setNotice(error instanceof Error ? error.message : "사이트 상태를 불러오지 못했습니다."); }
    })();
  }, []);

  const save = async () => {
    if (!token || busy) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/admin/owner/site-status", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ status, message }) });
      const payload = await response.json() as SitePayload;
      if (!response.ok) throw new Error(payload.error ?? "사이트 상태를 저장하지 못했습니다.");
      setUpdatedAt(payload.updatedAt ?? null); setDbConnected(payload.dbConnected === true); setNotice("사이트 상태를 저장했습니다.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "사이트 상태를 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  return <section className="border border-line bg-surface p-5"><div className="flex flex-col gap-3 border-b border-line pb-5"><div><p className="eyebrow text-muted">사이트 · 운영 상태</p><h2 className="mt-2 text-xl font-black">사이트 상태</h2><p className="mt-2 text-xs leading-5 text-muted">서비스 상태 안내와 데이터베이스 연결 상태를 관리합니다.</p></div><span className={`inline-flex w-fit items-center gap-2 border px-3 py-2 text-[10px] font-bold ${dbConnected ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}><Activity size={13} /> {dbConnected ? "데이터베이스 연결됨" : "데이터베이스 확인 필요"}</span></div><div className="mt-5 grid gap-3"><label className="grid gap-2 text-[10px] font-bold">운영 상태<select className="h-11 border border-line bg-paper px-3 text-xs font-normal" onChange={(event) => setStatus(event.target.value as SiteStatus)} value={status}><option value="operational">정상 운영</option><option value="maintenance">점검 중</option><option value="preparing">준비 중</option></select></label><label className="grid gap-2 text-[10px] font-bold">방문자 안내 문구<input className="h-11 min-w-0 border border-line bg-paper px-3 text-xs font-normal" maxLength={500} onChange={(event) => setMessage(event.target.value)} placeholder="예: 오늘 23:00까지 점검합니다." value={message} /></label><button className="inline-flex h-11 items-center justify-center gap-2 self-end bg-ink px-5 text-xs font-bold text-paper disabled:opacity-40" disabled={!token || busy} onClick={() => void save()} type="button"><Save size={14} /> {busy ? "저장 중..." : "저장"}</button></div>{notice && <p aria-live="polite" className="mt-4 text-xs text-muted">{notice}</p>}{updatedAt && <p className="mt-4 text-[10px] text-muted">마지막 변경: {new Date(updatedAt).toLocaleString("ko-KR")}</p>}</section>;
}
