"use client";

import { Download, RefreshCw, Truck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface RequestRow { request_id: string; member_id: string; item_count: number; product_ids: string[]; requested_at: string; shipped_at?: string | null; status: string; tracking_number: string | null; courier: string | null; address_snapshot: Record<string, unknown>; }
type ShippingForm = { courier: string; tracking: string };
function csv(value: unknown) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }

export function OperatorShippingConsole() {
  const [token, setToken] = useState<string | null>(null); const [requests, setRequests] = useState<RequestRow[]>([]); const [includeShipped, setIncludeShipped] = useState(false); const [filter, setFilter] = useState("all"); const [notice, setNotice] = useState(""); const [forms, setForms] = useState<Record<string, ShippingForm>>({}); const [busy, setBusy] = useState(false);
  const load = useCallback(async (accessToken: string | null, shipped = includeShipped) => { if (!accessToken) return; const response = await fetch(`/api/admin/operator/shipping?includeShipped=${shipped}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }); const payload = await response.json() as { requests?: RequestRow[]; error?: string }; if (!response.ok) throw new Error(payload.error ?? "배송 목록을 불러오지 못했습니다."); setRequests(payload.requests ?? []); }, [includeShipped]);
  useEffect(() => { void (async () => { try { const session = (await getSupabaseBrowserClient().auth.getSession()).data.session; setToken(session?.access_token ?? null); if (session) await load(session.access_token, false); } catch (error) { setNotice(error instanceof Error ? error.message : "배송 목록을 불러오지 못했습니다."); } })(); }, [load]);
  const visible = useMemo(() => requests.filter((row) => filter === "all" || row.status === filter), [filter, requests]);
  const updateForm = (requestId: string, key: keyof ShippingForm, value: string) => setForms((current) => ({ ...current, [requestId]: { ...(current[requestId] ?? { courier: "", tracking: "" }), [key]: value } }));
  const ship = async (requestId: string) => { if (!token || busy) return; const form = forms[requestId]; if (!form?.courier.trim() || !form.tracking.trim()) { setNotice("택배사와 운송장 번호를 입력해 주세요."); return; } setBusy(true); setNotice(""); try { const response = await fetch("/api/admin/operator/shipping", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ requestId, courier: form.courier, trackingNumber: form.tracking }) }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error ?? "배송 상태를 변경하지 못했습니다."); setNotice("배송 송장을 저장했습니다."); await load(token, includeShipped); } catch (error) { setNotice(error instanceof Error ? error.message : "배송 상태를 변경하지 못했습니다."); } finally { setBusy(false); } };
  const download = () => { const rows = ["request_id,member_id,item_count,requested_at,status,courier,tracking_number,recipient,phone,address,product_ids", ...visible.map((row) => { const address = row.address_snapshot ?? {}; return [row.request_id, row.member_id, row.item_count, row.requested_at, row.status, row.courier, row.tracking_number, address.recipientName, address.phone, address.address, row.product_ids.join("|")].map(csv).join(","); })]; const url = URL.createObjectURL(new Blob([`\uFEFF${rows.join("\n")}`], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "ninety-nine-shipping.csv"; anchor.click(); URL.revokeObjectURL(url); };
  const requested = requests.filter((row) => row.status === "requested"); const shipped = requests.filter((row) => row.status === "shipped");
  return (
    <div className="space-y-8">
      <div className="flex flex-col items-stretch justify-between gap-5 border-b border-ink pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow text-muted">운영자 / 배송 업무</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-.06em] sm:text-4xl sm:tracking-[-.08em]">배송 업무</h1>
          <p className="mt-3 text-sm text-muted">합배송 요청에 저장된 주소를 확인하고 송장을 입력합니다.</p>
        </div>
        <button className="flex items-center justify-center gap-2 border border-line px-4 py-3 text-xs font-bold" onClick={() => void load(token).catch((error) => setNotice(error instanceof Error ? error.message : "새로고침에 실패했습니다."))} type="button"><RefreshCw size={13} /> 새로고침</button>
      </div>
      {notice && <div aria-live="polite" className="border border-line bg-surface px-4 py-3 text-xs">{notice}</div>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="border border-line p-5"><p className="text-xs text-muted">송장 입력 대기</p><p className="mt-3 font-mono text-3xl font-bold">{requested.length}</p></div>
        <div className="border border-line p-5"><Truck size={17} /><p className="mt-7 text-xs text-muted">발송 완료</p><p className="mt-3 font-mono text-3xl font-bold">{shipped.length}</p></div>
        <div className="border border-line bg-ink p-5 text-paper"><p className="eyebrow text-zinc-400">합배송 상품</p><p className="mt-7 font-mono text-3xl font-bold">{requests.reduce((sum, row) => sum + row.item_count, 0)}</p><p className="mt-2 text-xs text-zinc-400">현재 조회된 상품 수</p></div>
      </div>
      <div className="flex flex-col items-start justify-between gap-4 border-b border-line pb-4 sm:flex-row sm:items-center">
        <div className="flex gap-3 text-xs">
          <button className={filter === "all" ? "border-b-2 border-ink pb-2 font-bold" : "pb-2 text-muted"} onClick={() => setFilter("all")} type="button">전체 {requests.length}</button>
          <button className={filter === "requested" ? "border-b-2 border-ink pb-2 font-bold" : "pb-2 text-muted"} onClick={() => setFilter("requested")} type="button">대기 {requested.length}</button>
          <button className={filter === "shipped" ? "border-b-2 border-ink pb-2 font-bold" : "pb-2 text-muted"} onClick={() => setFilter("shipped")} type="button">완료 {shipped.length}</button>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:justify-end sm:gap-4">
          <label className="flex items-center gap-2 text-xs"><input checked={includeShipped} onChange={(event) => { setIncludeShipped(event.target.checked); void load(token, event.target.checked); }} type="checkbox" /> 발송 완료 포함</label>
          <button className="flex items-center gap-2 border border-ink px-3 py-2 text-[10px] font-bold" onClick={download} type="button"><Download size={13} /> CSV 다운로드</button>
        </div>
      </div>
      <div className="border border-line">
        {visible.map((row) => {
          const address = row.address_snapshot ?? {};
          return (
            <article className="border-b border-line px-3 py-5 last:border-b-0 sm:px-5" key={row.request_id}>
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:gap-6">
                <div className="min-w-0">
                  <p className="break-all text-sm font-bold">{row.request_id} · {row.item_count}개 상품</p>
                  <p className="mt-1 break-all text-xs text-muted">회원 {row.member_id} · 요청 {new Date(row.requested_at).toLocaleString("ko-KR")}</p>
                  <p className="mt-3 break-words text-xs leading-5">{String(address.recipientName ?? "수령인 미상")} · {String(address.phone ?? "연락처 미상")}<br />{String(address.address ?? "저장된 주소 없음")}</p>
                  <p className="mt-2 break-all font-mono text-[10px] text-muted">상품 {row.product_ids.join(", ")}</p>
                </div>
                <span className={`shrink-0 ${row.status === "requested" ? "border border-amber-300 px-2 py-1 text-[10px] font-bold text-amber-700" : "border border-emerald-300 px-2 py-1 text-[10px] font-bold text-emerald-700"}`}>{row.status === "requested" ? "입력 대기" : "발송 완료"}</span>
              </div>
              {row.status === "requested" ? (
                <div className="mt-5 grid grid-cols-1 gap-2 border-t border-line pt-4 sm:grid-cols-[minmax(0,160px)_minmax(0,220px)_auto]">
                  <input aria-label={`${row.request_id} 택배사`} className="h-10 w-full border border-line px-3 text-xs" onChange={(event) => updateForm(row.request_id, "courier", event.target.value)} placeholder="택배사" value={forms[row.request_id]?.courier ?? ""} />
                  <input aria-label={`${row.request_id} 운송장`} className="h-10 w-full border border-line px-3 text-xs" onChange={(event) => updateForm(row.request_id, "tracking", event.target.value)} placeholder="운송장 번호" value={forms[row.request_id]?.tracking ?? ""} />
                  <button className="h-10 bg-ink px-4 text-xs font-bold text-paper disabled:opacity-40" disabled={busy} onClick={() => void ship(row.request_id)} type="button">발송 완료 저장</button>
                </div>
              ) : (
                <p className="mt-4 break-words border-t border-line pt-4 text-xs text-muted">{row.courier} · {row.tracking_number} · {row.shipped_at ? new Date(row.shipped_at).toLocaleString("ko-KR") : "발송일 미기록"}</p>
              )}
            </article>
          );
        })}
        {visible.length === 0 && <p className="py-16 text-center text-sm text-muted">배송 요청이 없습니다.</p>}
      </div>
    </div>
  );
}
