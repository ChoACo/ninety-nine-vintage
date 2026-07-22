"use client";

import { AlertTriangle, FileUp, RefreshCw, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type ExceptionKind = "inspection_required" | "missing" | "offline_sold" | "additional_wait" | "refund_required";
type Resolution = "resume" | "exclude_for_later" | "refund";

interface Candidate {
  inventoryItemId: string;
  productId: string;
  title: string;
  imageUrl: string | null;
  memberId: string;
  businessId: string;
  originStoreId: string;
  originStoreName: string;
  activeShipmentId: string | null;
  physicalStatus: string;
  locationKind: string;
  isBlocked: boolean;
  blockReason: string | null;
  version: number;
}
interface ExceptionCase {
  id: string;
  inventoryItemId: string;
  productId: string;
  title: string;
  imageUrl: string | null;
  memberId: string;
  businessId: string;
  originStoreId: string;
  originStoreName: string;
  shipmentId: string | null;
  kind: string;
  status: string;
  resolution: string | null;
  publicReason: string;
  internalNote: string | null;
  dueAt: string | null;
  version: number;
  createdAt: string;
  evidencePaths: string[];
}
type ResolutionForm = { resolution: Resolution; publicReason: string; internalNote: string };

const PAGE_SIZE = 50;
const OPEN_KEY_PREFIX = "ninety-nine:inventory-exception-open:";
const RESOLVE_KEY_PREFIX = "ninety-nine:inventory-exception-resolve:";
const EVIDENCE_KEY_PREFIX = "ninety-nine:inventory-exception-evidence:";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function isTextOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
function isCandidate(value: unknown): value is Candidate {
  return isRecord(value) && Object.keys(value).length === 14 && typeof value.inventoryItemId === "string" && typeof value.productId === "string" && typeof value.title === "string" && isTextOrNull(value.imageUrl) && typeof value.memberId === "string" && typeof value.businessId === "string" && typeof value.originStoreId === "string" && typeof value.originStoreName === "string" && isTextOrNull(value.activeShipmentId) && typeof value.physicalStatus === "string" && typeof value.locationKind === "string" && typeof value.isBlocked === "boolean" && isTextOrNull(value.blockReason) && isInteger(value.version);
}
function isExceptionCase(value: unknown): value is ExceptionCase {
  return isRecord(value) && Object.keys(value).length === 19 && typeof value.id === "string" && typeof value.inventoryItemId === "string" && typeof value.productId === "string" && typeof value.title === "string" && isTextOrNull(value.imageUrl) && typeof value.memberId === "string" && typeof value.businessId === "string" && typeof value.originStoreId === "string" && typeof value.originStoreName === "string" && isTextOrNull(value.shipmentId) && typeof value.kind === "string" && typeof value.status === "string" && isTextOrNull(value.resolution) && typeof value.publicReason === "string" && isTextOrNull(value.internalNote) && isTextOrNull(value.dueAt) && isInteger(value.version) && typeof value.createdAt === "string" && Array.isArray(value.evidencePaths) && value.evidencePaths.every((path) => typeof path === "string");
}
function isPayload(value: unknown): value is { candidates: Candidate[]; cases: ExceptionCase[] } {
  return isRecord(value) && Object.keys(value).length === 2 && Array.isArray(value.candidates) && value.candidates.every(isCandidate) && Array.isArray(value.cases) && value.cases.every(isExceptionCase);
}
function isSignedEvidence(value: unknown): value is { signedUrl: string } {
  return isRecord(value) && typeof value.signedUrl === "string";
}
function formatAt(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("ko-KR");
}
function kindLabel(value: string) {
  return { inspection_required: "상품 확인 필요", missing: "상품 분실", offline_sold: "오프라인 판매", additional_wait: "추가 대기", refund_required: "환불 필요" }[value] ?? value;
}
function resolutionLabel(value: string | null) {
  if (!value) return "처리 중";
  return { resume: "배송 재개", exclude_for_later: "다음 배송으로 제외", refund: "환불 요청 생성" }[value] ?? value;
}
function statusLabel(value: string) {
  return { open: "처리 중", resolved: "처리 완료", center_stored: "중앙 보관 완료", held: "보류" }[value] ?? value;
}
function commandKey(prefix: string, values: string[]) {
  return `${prefix}${values.join(":")}`;
}

export function OperatorExceptionsConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [cases, setCases] = useState<ExceptionCase[]>([]);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [openForm, setOpenForm] = useState({ kind: "inspection_required" as ExceptionKind, publicReason: "", internalNote: "", dueAt: "" });
  const [resolutionForms, setResolutionForms] = useState<Record<string, ResolutionForm>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [evidenceLinks, setEvidenceLinks] = useState<Record<string, string[]>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async (accessToken: string | null, resolved: boolean, nextOffset: number) => {
    if (!accessToken) return;
    const query = new URLSearchParams({ includeResolved: String(resolved), limit: String(PAGE_SIZE), offset: String(nextOffset) });
    const response = await fetch(`/api/admin/operator/exceptions?${query}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok || !isPayload(payload)) {
      const message = isRecord(payload) && typeof payload.message === "string" ? payload.message : "상품 예외 목록을 불러오지 못했습니다.";
      throw new Error(message);
    }
    setCandidates(payload.candidates);
    setCases(payload.cases);
    setSelectedItemId((current) => current || payload.candidates[0]?.inventoryItemId || "");
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
        const accessToken = session?.access_token ?? null;
        setToken(accessToken);
        if (accessToken) await load(accessToken, false, 0);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "상품 예외 목록을 불러오지 못했습니다.");
      }
    })();
  }, [load]);

  const refresh = () => void load(token, includeResolved, offset).catch((error) => setNotice(error instanceof Error ? error.message : "새로고침에 실패했습니다."));
  const toggleResolved = (next: boolean) => {
    setIncludeResolved(next); setOffset(0);
    void load(token, next, 0).catch((error) => setNotice(error instanceof Error ? error.message : "상품 예외 목록을 불러오지 못했습니다."));
  };
  const changePage = (nextOffset: number) => {
    setOffset(nextOffset);
    void load(token, includeResolved, nextOffset).catch((error) => setNotice(error instanceof Error ? error.message : "상품 예외 목록을 불러오지 못했습니다."));
  };

  const openException = async () => {
    if (!token || busyKey || !selectedItemId) return;
    const key = commandKey(OPEN_KEY_PREFIX, [selectedItemId, openForm.kind, openForm.publicReason.trim(), openForm.dueAt]);
    const idempotencyKey = sessionStorage.getItem(key) ?? crypto.randomUUID();
    sessionStorage.setItem(key, idempotencyKey);
    setBusyKey(key); setNotice("");
    try {
      const response = await fetch("/api/admin/operator/exceptions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "open", inventoryItemId: selectedItemId, kind: openForm.kind, publicReason: openForm.publicReason.trim(), internalNote: openForm.internalNote.trim() || null, dueAt: openForm.dueAt ? new Date(openForm.dueAt).toISOString() : null, idempotencyKey }) });
      const payload = await response.json().catch(() => null) as unknown;
      if (response.status === 409) { await load(token, includeResolved, offset); throw new Error("상품 상태가 변경되었습니다. 최신 목록을 확인해 주세요."); }
      if (!response.ok || !isRecord(payload) || !isRecord(payload.exception) || payload.exception.status !== "open") throw new Error(isRecord(payload) && typeof payload.message === "string" ? payload.message : "예외 등록 결과를 확인하지 못했습니다.");
      sessionStorage.removeItem(key);
      setOpenForm({ kind: "inspection_required", publicReason: "", internalNote: "", dueAt: "" });
      setNotice("상품 예외를 등록했습니다. 배송 상품은 보류 처리됩니다.");
      await load(token, includeResolved, offset);
    } catch (error) { setNotice(error instanceof Error ? error.message : "상품 예외를 등록하지 못했습니다."); }
    finally { setBusyKey(null); }
  };

  const formFor = (exceptionCase: ExceptionCase): ResolutionForm => resolutionForms[exceptionCase.id] ?? { resolution: "resume", publicReason: exceptionCase.publicReason, internalNote: exceptionCase.internalNote ?? "" };
  const resolveCase = async (exceptionCase: ExceptionCase) => {
    if (!token || busyKey) return;
    const form = formFor(exceptionCase);
    const key = commandKey(RESOLVE_KEY_PREFIX, [exceptionCase.id, String(exceptionCase.version), form.resolution, form.publicReason.trim()]);
    const idempotencyKey = sessionStorage.getItem(key) ?? crypto.randomUUID();
    sessionStorage.setItem(key, idempotencyKey);
    setBusyKey(key); setNotice("");
    try {
      const response = await fetch("/api/admin/operator/exceptions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "resolve", caseId: exceptionCase.id, expectedVersion: exceptionCase.version, resolution: form.resolution, publicReason: form.publicReason.trim(), internalNote: form.internalNote.trim() || null, idempotencyKey }) });
      const payload = await response.json().catch(() => null) as unknown;
      if (response.status === 409) { await load(token, includeResolved, offset); throw new Error("예외 건 상태가 변경되었습니다. 최신 목록을 확인해 주세요."); }
      if (!response.ok || !isRecord(payload) || !isRecord(payload.exception) || payload.exception.status !== "resolved") throw new Error(isRecord(payload) && typeof payload.message === "string" ? payload.message : "예외 해결 결과를 확인하지 못했습니다.");
      sessionStorage.removeItem(key);
      setNotice(payload.exception.refundId ? "환불 요청을 생성했습니다. Owner 승인 대기열로 이동합니다." : "상품 예외를 해결했습니다.");
      await load(token, includeResolved, offset);
    } catch (error) { setNotice(error instanceof Error ? error.message : "상품 예외를 해결하지 못했습니다."); }
    finally { setBusyKey(null); }
  };

  const loadEvidence = async (exceptionCase: ExceptionCase) => {
    if (!token) return;
    try {
      const response = await fetch(`/api/admin/operator/exceptions/${encodeURIComponent(exceptionCase.id)}/evidence`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const payload = await response.json().catch(() => null) as unknown;
      const evidence = isRecord(payload) && Array.isArray(payload.evidence) ? payload.evidence : null;
      if (!response.ok || !evidence || !evidence.every(isSignedEvidence)) throw new Error(isRecord(payload) && typeof payload.message === "string" ? payload.message : "증빙 링크를 불러오지 못했습니다.");
      setEvidenceLinks((current) => ({ ...current, [exceptionCase.id]: evidence.map((item) => item.signedUrl) }));
    } catch (error) { setNotice(error instanceof Error ? error.message : "증빙 링크를 불러오지 못했습니다."); }
  };

  const uploadEvidence = async (exceptionCase: ExceptionCase) => {
    const file = files[exceptionCase.id];
    if (!token || !file || busyKey) { if (!file) setNotice("증빙 파일을 선택해 주세요."); return; }
    const key = commandKey(EVIDENCE_KEY_PREFIX, [exceptionCase.id, String(exceptionCase.version), file.name, String(file.size), file.type]);
    const idempotencyKey = sessionStorage.getItem(key) ?? crypto.randomUUID();
    sessionStorage.setItem(key, idempotencyKey);
    const form = new FormData(); form.set("file", file); form.set("idempotencyKey", idempotencyKey);
    setBusyKey(key); setNotice("");
    try {
      const response = await fetch(`/api/admin/operator/exceptions/${encodeURIComponent(exceptionCase.id)}/evidence`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      const payload = await response.json().catch(() => null) as unknown;
      const evidence = isRecord(payload) && isSignedEvidence(payload.evidence) ? payload.evidence : null;
      if (!response.ok || !evidence) throw new Error(isRecord(payload) && typeof payload.message === "string" ? payload.message : "증빙 업로드 결과를 확인하지 못했습니다.");
      sessionStorage.removeItem(key);
      setFiles((current) => ({ ...current, [exceptionCase.id]: null }));
      setEvidenceLinks((current) => ({ ...current, [exceptionCase.id]: [...(current[exceptionCase.id] ?? []), evidence.signedUrl] }));
      setNotice("비공개 증빙 파일을 등록했습니다. 링크는 5분 동안만 유효합니다.");
      await load(token, includeResolved, offset);
    } catch (error) { setNotice(error instanceof Error ? error.message : "증빙 파일을 업로드하지 못했습니다."); }
    finally { setBusyKey(null); }
  };

  const summary = useMemo(() => ({ open: cases.filter((exceptionCase) => exceptionCase.status === "open").length, refund: cases.filter((exceptionCase) => exceptionCase.resolution === "refund").length }), [cases]);

  return <div className="space-y-8">
    <div className="flex flex-col items-stretch justify-between gap-5 border-b border-ink pb-6 sm:flex-row sm:items-end"><div><p className="eyebrow text-muted">운영자 / 상품 예외</p><h1 className="mt-3 text-3xl font-black tracking-[-.06em] sm:text-4xl sm:tracking-[-.08em]">상품 예외</h1><p className="mt-3 text-sm text-muted">보관 상품과 배송 요청 상품의 확인·보류·분실·오프라인 판매를 기록하고 필요한 경우 환불 요청을 만듭니다.</p></div><button className="flex items-center justify-center gap-2 border border-line px-4 py-3 text-xs font-bold" onClick={refresh} type="button"><RefreshCw size={13} /> 새로고침</button></div>
    {notice && <div aria-live="polite" className="border border-line bg-surface px-4 py-3 text-xs">{notice}</div>}
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="border border-line p-5"><AlertTriangle size={17} /><p className="mt-7 text-xs text-muted">처리 중 예외</p><p className="mt-3 font-mono text-3xl font-bold">{summary.open}</p></div><div className="border border-line bg-ink p-5 text-paper"><ShieldAlert size={17} /><p className="mt-7 text-xs text-zinc-400">환불 요청 생성</p><p className="mt-3 font-mono text-3xl font-bold">{summary.refund}</p></div></div>
    <section className="border border-line p-4 sm:p-5"><p className="text-sm font-bold">상품 예외 등록</p><p className="mt-2 text-xs text-muted">배송 요청에 없는 결제 완료 보관 상품도 선택할 수 있습니다. 등록 즉시 해당 상품은 보류됩니다.</p><div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"><select aria-label="예외 상품" className="h-10 border border-line bg-paper px-3 text-xs" onChange={(event) => setSelectedItemId(event.target.value)} value={selectedItemId}><option value="">상품 선택</option>{candidates.map((item) => <option key={item.inventoryItemId} value={item.inventoryItemId}>{item.originStoreName} · {item.title} · {item.activeShipmentId ? "배송 요청됨" : "보관 중"}</option>)}</select><select aria-label="예외 종류" className="h-10 border border-line bg-paper px-3 text-xs" onChange={(event) => setOpenForm((current) => ({ ...current, kind: event.target.value as ExceptionKind }))} value={openForm.kind}>{(["inspection_required", "missing", "offline_sold", "additional_wait", "refund_required"] as const).map((kind) => <option key={kind} value={kind}>{kindLabel(kind)}</option>)}</select><input aria-label="구매자 안내 사유" className="h-10 border border-line px-3 text-xs" maxLength={1000} onChange={(event) => setOpenForm((current) => ({ ...current, publicReason: event.target.value }))} placeholder="구매자에게 보일 사유 (3자 이상)" value={openForm.publicReason} /><input aria-label="처리 기한" className="h-10 border border-line px-3 text-xs" onChange={(event) => setOpenForm((current) => ({ ...current, dueAt: event.target.value }))} type="datetime-local" value={openForm.dueAt} /><textarea aria-label="내부 메모" className="min-h-24 border border-line px-3 py-2 text-xs sm:col-span-2" maxLength={2000} onChange={(event) => setOpenForm((current) => ({ ...current, internalNote: event.target.value }))} placeholder="내부 메모 (구매자에게 노출되지 않음)" value={openForm.internalNote} /></div><button className="mt-4 h-10 bg-ink px-4 text-xs font-bold text-paper disabled:opacity-40" disabled={!selectedItemId || openForm.publicReason.trim().length < 3 || busyKey !== null} onClick={() => void openException()} type="button">예외 등록 · 상품 보류</button></section>
    <div className="flex items-center justify-between gap-4 border-b border-line pb-4"><label className="flex items-center gap-2 text-xs font-bold"><input checked={includeResolved} onChange={(event) => toggleResolved(event.target.checked)} type="checkbox" /> 처리 완료 내역 포함</label><p className="text-xs text-muted">현재 페이지 {cases.length}건</p></div>
    <div className="border border-line">{cases.map((exceptionCase) => { const form = formFor(exceptionCase); const links = evidenceLinks[exceptionCase.id] ?? []; return <article className="border-b border-line px-4 py-5 last:border-b-0 sm:px-5" key={exceptionCase.id}><div className="flex flex-col items-start justify-between gap-4 sm:flex-row"><div><div className="flex flex-wrap gap-2"><span className="border border-line px-2 py-1 text-[10px] font-bold">{kindLabel(exceptionCase.kind)}</span><span className="border border-line px-2 py-1 text-[10px] font-bold">{statusLabel(exceptionCase.status)}</span><span className="border border-line px-2 py-1 text-[10px] font-bold">{resolutionLabel(exceptionCase.resolution)}</span></div><p className="mt-3 text-sm font-bold">{exceptionCase.title} · {exceptionCase.originStoreName}</p><p className="mt-1 break-all font-mono text-[10px] text-muted">구매자 {exceptionCase.memberId} · 배송 {exceptionCase.shipmentId ?? "보관함"} · 버전 {exceptionCase.version}</p></div><p className="text-xs text-muted">등록 {formatAt(exceptionCase.createdAt)}<br />기한 {formatAt(exceptionCase.dueAt)}</p></div><div className="mt-4 border-t border-line pt-4 text-xs"><p><span className="text-muted">구매자 안내</span> · {exceptionCase.publicReason}</p>{exceptionCase.internalNote && <p className="mt-2 text-muted">내부 메모 · {exceptionCase.internalNote}</p>}</div>{exceptionCase.status === "open" && <div className="mt-5 border-t border-line pt-4"><div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><select aria-label={`${exceptionCase.id} 해결 방식`} className="h-10 border border-line bg-paper px-3 text-xs" onChange={(event) => setResolutionForms((current) => ({ ...current, [exceptionCase.id]: { ...form, resolution: event.target.value as Resolution } }))} value={form.resolution}><option value="resume">배송 재개</option><option value="exclude_for_later">추가 대기 · 다음 배송으로 제외</option><option value="refund">환불 요청 생성</option></select><input aria-label={`${exceptionCase.id} 구매자 안내`} className="h-10 border border-line px-3 text-xs" maxLength={1000} onChange={(event) => setResolutionForms((current) => ({ ...current, [exceptionCase.id]: { ...form, publicReason: event.target.value } }))} value={form.publicReason} /><textarea aria-label={`${exceptionCase.id} 내부 메모`} className="min-h-20 border border-line px-3 py-2 text-xs sm:col-span-2" maxLength={2000} onChange={(event) => setResolutionForms((current) => ({ ...current, [exceptionCase.id]: { ...form, internalNote: event.target.value } }))} value={form.internalNote} /></div><button className="mt-3 h-10 bg-ink px-4 text-xs font-bold text-paper disabled:opacity-40" disabled={form.publicReason.trim().length < 3 || busyKey !== null} onClick={() => void resolveCase(exceptionCase)} type="button">{form.resolution === "refund" ? "환불 요청 생성" : "예외 해결 저장"}</button></div>}<div className="mt-5 border-t border-line pt-4"><div className="flex flex-wrap items-center gap-3"><p className="text-xs font-bold">비공개 증빙 {exceptionCase.evidencePaths.length}건</p><button className="border border-line px-3 py-2 text-[10px] font-bold" onClick={() => void loadEvidence(exceptionCase)} type="button">5분 링크 보기</button>{exceptionCase.status === "open" && <><input accept="image/jpeg,image/png,image/webp,application/pdf" aria-label={`${exceptionCase.id} 증빙 파일`} className="max-w-full text-xs" onChange={(event) => setFiles((current) => ({ ...current, [exceptionCase.id]: event.target.files?.[0] ?? null }))} type="file" /><button className="flex items-center gap-2 border border-ink px-3 py-2 text-[10px] font-bold disabled:opacity-40" disabled={!files[exceptionCase.id] || busyKey !== null} onClick={() => void uploadEvidence(exceptionCase)} type="button"><FileUp size={12} /> 증빙 업로드</button></>}</div>{links.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{links.map((url, index) => <a className="border border-line px-3 py-2 text-[10px] font-bold underline" href={url} key={url} rel="noreferrer" target="_blank">증빙 {index + 1} 보기</a>)}</div>}</div></article>; })}{cases.length === 0 && <p className="py-16 text-center text-sm text-muted">표시할 상품 예외가 없습니다.</p>}</div>
    <div className="flex items-center justify-between gap-4"><button className="border border-line px-4 py-2 text-xs font-bold disabled:opacity-40" disabled={offset === 0} onClick={() => changePage(Math.max(0, offset - PAGE_SIZE))} type="button">이전</button><p className="font-mono text-[11px] text-muted">{offset + 1}–{offset + cases.length}</p><button className="border border-line px-4 py-2 text-xs font-bold disabled:opacity-40" disabled={cases.length < PAGE_SIZE} onClick={() => changePage(offset + PAGE_SIZE)} type="button">다음</button></div>
  </div>;
}
