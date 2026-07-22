"use client";

import { Archive, Inbox, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface StoreItem {
  inventoryItemId: string;
  productId: string;
  title: string;
  imageUrl: string;
  lineStatus: string;
  physicalStatus: string;
  fulfillmentVersion: number;
  isBlocked: boolean;
}
interface StoreWork {
  id: string;
  shipmentId: string;
  storeId: string;
  storeName: string;
  businessId: string;
  centerId: string;
  centerName: string;
  status: string;
  version: number;
  requestedAt: string | null;
  itemCount: number;
  readyCount: number;
  heldCount: number;
  items: StoreItem[];
}
interface CenterItem {
  inventoryItemId: string;
  productId: string;
  title: string;
  imageUrl: string;
  memberId: string;
  businessId: string;
  centerId: string;
  centerName: string;
  originStoreId: string;
  originStoreName: string;
  handoffMode: string;
  physicalStatus: string;
  locationKind: string;
  storageLocationCode: string | null;
  version: number;
  isBlocked: boolean;
  workDueDate: string | null;
}
interface PaidStoreGroup {
  storeId: string;
  storeName: string;
  businessId: string;
  centerId: string;
  centerName: string;
  items: CenterItem[];
}
interface QueuePayload {
  storeWorks?: StoreWork[];
  paidStoreGroups?: PaidStoreGroup[];
  centerItems?: CenterItem[];
  error?: string;
  message?: string;
}

const stageLabel: Record<string, string> = {
  entitled: "보관 준비 중",
  preparing: "매장 준비 중",
  in_transit_to_center: "중앙 이동 중",
  center_received: "중앙 입고 완료",
  center_stored: "중앙 보관 완료",
};

function pendingKey(actorId: string, scope: string) {
  return `ninety-nine:inventory-fulfillment:${actorId}:${scope}`;
}

function getOrCreateIdempotencyKey(actorId: string, scope: string) {
  const key = pendingKey(actorId, scope);
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) return existing;
    const created = crypto.randomUUID();
    window.sessionStorage.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function clearIdempotencyKey(actorId: string, scope: string) {
  try { window.sessionStorage.removeItem(pendingKey(actorId, scope)); } catch { /* storage access is optional */ }
}

function timestamp(value: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("ko-KR") : "시각 확인 중";
}

function paidGroupKey(group: PaidStoreGroup) {
  return `${group.businessId}:${group.storeId}:${group.centerId}`;
}

function centerActionKey(action: "receive" | "store", centerId: string) {
  return `${action}:${centerId}`;
}

export function OperatorFulfillmentConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [actorId, setActorId] = useState<string | null>(null);
  const [storeWorks, setStoreWorks] = useState<StoreWork[]>([]);
  const [paidStoreGroups, setPaidStoreGroups] = useState<PaidStoreGroup[]>([]);
  const [centerItems, setCenterItems] = useState<CenterItem[]>([]);
  const [storeSelection, setStoreSelection] = useState<Record<string, string[]>>({});
  const [paidSelection, setPaidSelection] = useState<Record<string, string[]>>({});
  const [centerSelection, setCenterSelection] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [storageLocationCodes, setStorageLocationCodes] = useState<Record<string, string>>({});
  const [busyScope, setBusyScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const load = useCallback(async (accessToken: string) => {
    const response = await fetch("/api/admin/operator/fulfillment", {
      headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store",
    });
    const payload = await response.json() as QueuePayload;
    if (!response.ok) throw new Error(payload.message ?? "물류 목록을 불러오지 못했습니다.");
    setStoreWorks(payload.storeWorks ?? []);
    setPaidStoreGroups(payload.paidStoreGroups ?? []);
    setCenterItems(payload.centerItems ?? []);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
        if (!session) { setNotice("운영 계정으로 로그인해 주세요."); return; }
        setToken(session.access_token);
        setActorId(session.user.id);
        await load(session.access_token);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "물류 목록을 불러오지 못했습니다.");
      } finally { setLoading(false); }
    })();
  }, [load]);

  const refresh = async () => {
    if (!token) return;
    setLoading(true); setNotice("");
    try { await load(token); } catch (error) { setNotice(error instanceof Error ? error.message : "새로고침하지 못했습니다."); } finally { setLoading(false); }
  };

  const releaseStoreItems = async (work: StoreWork) => {
    const selected = storeSelection[work.id] ?? [];
    if (!token || !actorId || selected.length === 0 || busyScope) return;
    const scope = `release:${work.id}:${work.version}:${[...selected].sort().join(",")}`;
    setBusyScope(scope); setNotice("");
    try {
      const response = await fetch("/api/admin/operator/fulfillment", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release_store_items", workId: work.id, inventoryItemIds: selected, expectedWorkVersion: work.version, idempotencyKey: getOrCreateIdempotencyKey(actorId, scope), note: notes[work.id]?.trim() || null }),
      });
      const payload = await response.json() as QueuePayload;
      if (!response.ok) {
        if (response.status === 409) { await load(token); throw new Error("다른 담당자가 먼저 처리했습니다. 최신 목록으로 갱신했습니다."); }
        throw new Error(payload.message ?? "매장 출고 완료를 저장하지 못했습니다.");
      }
      clearIdempotencyKey(actorId, scope);
      setStoreSelection((current) => ({ ...current, [work.id]: [] }));
      setNotes((current) => ({ ...current, [work.id]: "" }));
      setNotice(`${work.storeName} 선택 상품 출고 완료를 저장했습니다.`);
      await load(token);
    } catch (error) { setNotice(error instanceof Error ? error.message : "매장 출고 완료를 저장하지 못했습니다."); } finally { setBusyScope(null); }
  };

  const releasePaidItems = async (group: PaidStoreGroup) => {
    const groupKey = paidGroupKey(group);
    const selected = paidSelection[groupKey] ?? [];
    const candidates = group.items.filter((item) => selected.includes(item.inventoryItemId));
    if (!token || !actorId || selected.length === 0 || busyScope) return;
    if (selected.length > 100 || candidates.length !== selected.length) {
      setNotice("한 번에 같은 매장의 최신 상품을 최대 100개까지 처리해 주세요.");
      return;
    }
    const scope = `paid-release:${groupKey}:${candidates.map((item) => `${item.inventoryItemId}:${item.version}`).sort().join(",")}`;
    setBusyScope(scope); setNotice("");
    try {
      const response = await fetch("/api/admin/operator/fulfillment", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release_paid_items", inventoryItemIds: candidates.map((item) => item.inventoryItemId), expectedVersions: candidates.map((item) => item.version), idempotencyKey: getOrCreateIdempotencyKey(actorId, scope), note: notes[`paid:${groupKey}`]?.trim() || null }),
      });
      const payload = await response.json() as QueuePayload;
      if (!response.ok) {
        if (response.status === 409) { await load(token); throw new Error("다른 담당자가 먼저 처리했습니다. 최신 목록으로 갱신했습니다."); }
        throw new Error(payload.message ?? "결제 완료 상품의 출고 준비를 저장하지 못했습니다.");
      }
      clearIdempotencyKey(actorId, scope);
      setPaidSelection((current) => ({ ...current, [groupKey]: [] }));
      setNotes((current) => ({ ...current, [`paid:${groupKey}`]: "" }));
      setNotice(`${group.storeName} 선택 상품의 출고 준비를 완료했습니다.`);
      await load(token);
    } catch (error) { setNotice(error instanceof Error ? error.message : "결제 완료 상품의 출고 준비를 저장하지 못했습니다."); } finally { setBusyScope(null); }
  };

  const recordCenterItems = async (action: "receive" | "store", centerId: string) => {
    const actionKey = centerActionKey(action, centerId);
    const selected = centerSelection[actionKey] ?? [];
    const candidates = centerItems.filter((item) => item.centerId === centerId && selected.includes(item.inventoryItemId));
    if (!token || !actorId || selected.length === 0 || candidates.length !== selected.length || busyScope) return;
    const location = action === "store" ? (storageLocationCodes[actionKey] ?? "").trim() : null;
    if (action === "store" && !location) { setNotice("선택 상품의 보관 위치를 입력해 주세요."); return; }
    const scope = `center:${action}:${centerId}:${candidates.map((item) => `${item.inventoryItemId}:${item.version}`).sort().join(",")}:${location ?? ""}`;
    setBusyScope(scope); setNotice("");
    try {
      const response = await fetch("/api/admin/operator/fulfillment", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: action === "receive" ? "center_receive" : "center_store", inventoryItemIds: candidates.map((item) => item.inventoryItemId), expectedVersions: candidates.map((item) => item.version), storageLocationCode: location, idempotencyKey: getOrCreateIdempotencyKey(actorId, scope), note: notes[`center:${actionKey}`]?.trim() || null }),
      });
      const payload = await response.json() as QueuePayload;
      if (!response.ok) {
        if (response.status === 409) { await load(token); throw new Error("다른 담당자가 먼저 처리했습니다. 최신 목록으로 갱신했습니다."); }
        throw new Error(payload.message ?? "중앙 물류 작업을 저장하지 못했습니다.");
      }
      clearIdempotencyKey(actorId, scope);
      setCenterSelection((current) => ({ ...current, [actionKey]: [] }));
      setNotes((current) => ({ ...current, [`center:${actionKey}`]: "" }));
      if (action === "store") setStorageLocationCodes((current) => ({ ...current, [actionKey]: "" }));
      setNotice(action === "receive" ? "선택 센터 상품의 입고를 확인했습니다." : "선택 센터 상품의 보관을 완료했습니다.");
      await load(token);
    } catch (error) { setNotice(error instanceof Error ? error.message : "중앙 물류 작업을 저장하지 못했습니다."); } finally { setBusyScope(null); }
  };

  const receiveItems = centerItems.filter((item) => item.physicalStatus === "in_transit_to_center");
  const storeItems = centerItems.filter((item) => item.physicalStatus === "center_received");
  const centerGroups = ([
    ["receive", receiveItems],
    ["store", storeItems],
  ] as const).flatMap(([action, items]) => {
    const byCenter = new Map<string, { centerId: string; centerName: string; items: CenterItem[] }>();
    for (const item of items) {
      const group = byCenter.get(item.centerId) ?? { centerId: item.centerId, centerName: item.centerName, items: [] };
      group.items.push(item);
      byCenter.set(item.centerId, group);
    }
    return [...byCenter.values()]
      .sort((left, right) => left.centerName.localeCompare(right.centerName, "ko"))
      .map((group) => ({ action, ...group }));
  });
  const toggleCenterAll = (action: "receive" | "store", centerId: string, items: CenterItem[], checked: boolean) => {
    const actionKey = centerActionKey(action, centerId);
    setCenterSelection((current) => ({
      ...current,
      [actionKey]: checked ? items.filter((item) => !item.isBlocked).slice(0, 100).map((item) => item.inventoryItemId) : [],
    }));
  };

  return <div className="space-y-9">
    <header className="flex flex-col items-stretch justify-between gap-5 border-b border-ink pb-6 sm:flex-row sm:items-end">
      <div><p className="eyebrow text-muted">운영자 / 통합 물류</p><h1 className="mt-3 text-3xl font-black tracking-[-.06em] sm:text-4xl sm:tracking-[-.08em]">매장 출고 · 중앙 입고</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted">원산지 매장별 작업을 분리해 출고 완료를 기록하고, 중앙센터에서 실제 입고와 보관을 순서대로 처리합니다.</p></div>
      <button className="flex items-center justify-center gap-2 border border-line px-4 py-3 text-xs font-bold disabled:opacity-40" disabled={!token || loading} onClick={() => void refresh()} type="button"><RefreshCw size={14} /> 새로고침</button>
    </header>
    {notice && <div aria-live="polite" className="border border-line bg-surface px-4 py-3 text-sm">{notice}</div>}
    <div className="grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-2 xl:grid-cols-4"><div className="bg-paper p-5"><p className="text-xs text-muted">결제 완료 보관 준비</p><p className="mt-3 font-mono text-3xl font-bold">{paidStoreGroups.reduce((sum, group) => sum + group.items.length, 0)}</p></div><div className="bg-paper p-5"><p className="text-xs text-muted">배송 요청 매장 작업</p><p className="mt-3 font-mono text-3xl font-bold">{storeWorks.length}</p></div><div className="bg-paper p-5"><p className="text-xs text-muted">중앙 입고 대기</p><p className="mt-3 font-mono text-3xl font-bold">{receiveItems.length}</p></div><div className="bg-ink p-5 text-paper"><p className="text-xs text-zinc-400">중앙 보관 대기</p><p className="mt-3 font-mono text-3xl font-bold">{storeItems.length}</p></div></div>

    <section className="space-y-4" aria-busy={loading}>
      <div><p className="eyebrow text-muted">결제 완료 · 매장별 보관 준비</p><h2 className="mt-2 text-xl font-black">전일 판매 상품 처리</h2><p className="mt-2 text-xs leading-5 text-muted">배송 신청 전이라도 결제가 끝난 상품을 원산지 매장별로 확인합니다. A 매장은 중앙 이동을 시작하고, 중앙과 같은 장소인 매장은 설정된 전달 경로에 따라 바로 입고 단계로 이동합니다.</p></div>
      {paidStoreGroups.map((group) => {
        const groupKey = paidGroupKey(group);
        const selectable = group.items.filter((item) => !item.isBlocked).slice(0, 100);
        const selected = paidSelection[groupKey] ?? [];
        const allSelected = selectable.length > 0 && selectable.every((item) => selected.includes(item.inventoryItemId));
        return <article className="border border-line" key={groupKey}>
          <div className="flex flex-col justify-between gap-3 border-b border-line bg-surface p-5 sm:flex-row sm:items-start"><div><p className="text-sm font-black">{group.storeName} → {group.centerName}</p><p className="mt-2 text-[11px] text-muted">매장·매출 단위는 분리되며, 상품은 설정된 센터 경로로만 인계됩니다.</p></div><span className="border border-line bg-paper px-2 py-1 text-[10px] font-bold">대상 {group.items.length}</span></div>
          <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]"><div className="space-y-3">{selectable.length > 0 && <label className="flex items-center gap-2 border-b border-line pb-3 text-xs font-bold"><input checked={allSelected} onChange={(event) => setPaidSelection((current) => ({ ...current, [groupKey]: event.target.checked ? selectable.map((item) => item.inventoryItemId) : [] }))} type="checkbox" /> 현재 매장 상품 전체 선택{group.items.length > 100 ? " (최대 100개)" : ""}</label>}{group.items.map((item) => { const checked = selected.includes(item.inventoryItemId); const disabled = item.isBlocked || (!checked && selected.length >= 100); return <label className={`flex items-start gap-3 border-b border-line pb-3 last:border-b-0 ${disabled ? "opacity-60" : "cursor-pointer"}`} key={item.inventoryItemId}><input checked={checked} disabled={disabled} onChange={(event) => setPaidSelection((current) => ({ ...current, [groupKey]: event.target.checked ? [...(current[groupKey] ?? []), item.inventoryItemId] : (current[groupKey] ?? []).filter((id) => id !== item.inventoryItemId) }))} type="checkbox" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{item.title}</span><span className="mt-1 block text-[11px] text-muted">{stageLabel[item.physicalStatus] ?? item.physicalStatus} · {item.handoffMode} · v{item.version}</span><span className="mt-1 block text-[11px] text-muted">처리 예정 {timestamp(item.workDueDate)}</span>{item.isBlocked && <span className="mt-1 block text-[11px] text-rose-700">예외 또는 상품 확인 처리 중</span>}</span></label>; })}</div>
            <div className="border border-line p-4"><p className="text-xs font-bold">{group.storeName} 출고 준비</p><p className="mt-2 text-xs leading-5 text-muted">선택한 {selected.length}개만 상태를 전환합니다. 다른 매장 상품은 함께 처리되지 않습니다.</p><textarea aria-label={`${group.storeName} 보관 준비 메모`} className="mt-4 min-h-20 w-full resize-y border border-line bg-paper p-3 text-xs" maxLength={1_000} onChange={(event) => setNotes((current) => ({ ...current, [`paid:${groupKey}`]: event.target.value }))} placeholder="메모 (선택)" value={notes[`paid:${groupKey}`] ?? ""} /><button className="mt-3 flex w-full items-center justify-center gap-2 bg-ink px-4 py-3 text-xs font-bold text-paper disabled:opacity-40" disabled={selected.length === 0 || Boolean(busyScope)} onClick={() => void releasePaidItems(group)} type="button"><Send size={14} /> 선택 상품 출고 준비 완료</button></div>
          </div>
        </article>;
      })}
      {!loading && paidStoreGroups.length === 0 && <div className="border border-dashed border-line py-12 text-center text-sm text-muted">현재 결제 완료 후 매장에서 처리할 상품이 없습니다.</div>}
    </section>

    <section className="space-y-4 border-t border-ink pt-8" aria-busy={loading}>
      <div><p className="eyebrow text-muted">원산지 매장별 출고</p><h2 className="mt-2 text-xl font-black">매장 작업 목록</h2></div>
      {storeWorks.map((work) => {
        const releasable = work.items.filter((item) => item.lineStatus === "requested" && !item.isBlocked);
        const selected = storeSelection[work.id] ?? [];
        const allSelected = releasable.length > 0 && releasable.every((item) => selected.includes(item.inventoryItemId));
        return <article className="border border-line" key={work.id}>
          <div className="flex flex-col justify-between gap-3 border-b border-line bg-surface p-5 sm:flex-row sm:items-start"><div><p className="text-sm font-black">{work.storeName} → {work.centerName}</p><p className="mt-2 text-[11px] text-muted">배송 요청 {work.shipmentId} · {timestamp(work.requestedAt)} · 작업 버전 {work.version}</p></div><div className="flex gap-2 text-[10px] font-bold"><span className="border border-line bg-paper px-2 py-1">상품 {work.itemCount}</span><span className="border border-line bg-paper px-2 py-1">준비 {work.readyCount}</span>{work.heldCount > 0 && <span className="border border-rose-300 bg-paper px-2 py-1 text-rose-700">보류 {work.heldCount}</span>}</div></div>
          <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]"><div className="space-y-3">{releasable.length > 0 && <label className="flex items-center gap-2 border-b border-line pb-3 text-xs font-bold"><input checked={allSelected} onChange={(event) => setStoreSelection((current) => ({ ...current, [work.id]: event.target.checked ? releasable.map((item) => item.inventoryItemId) : [] }))} type="checkbox" /> 이 매장 상품 전체 선택</label>}{work.items.map((item) => { const disabled = item.lineStatus !== "requested" || item.isBlocked; return <label className={`flex items-start gap-3 border-b border-line pb-3 last:border-b-0 ${disabled ? "opacity-60" : "cursor-pointer"}`} key={item.inventoryItemId}><input checked={selected.includes(item.inventoryItemId)} disabled={disabled} onChange={(event) => setStoreSelection((current) => ({ ...current, [work.id]: event.target.checked ? [...(current[work.id] ?? []), item.inventoryItemId] : (current[work.id] ?? []).filter((id) => id !== item.inventoryItemId) }))} type="checkbox" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{item.title}</span><span className="mt-1 block text-[11px] text-muted">{stageLabel[item.physicalStatus] ?? item.physicalStatus} · {item.lineStatus} · v{item.fulfillmentVersion}</span>{item.isBlocked && <span className="mt-1 block text-[11px] text-rose-700">예외 또는 상품 확인 처리 중</span>}</span></label>; })}</div>
            <div className="border border-line p-4"><p className="text-xs font-bold">{work.centerName} 인계</p><p className="mt-2 text-xs leading-5 text-muted">선택한 {selected.length}개 상품만 출고 완료로 기록합니다. 매장별 작업은 서로 섞이지 않습니다.</p><textarea aria-label={`${work.storeName} 출고 메모`} className="mt-4 min-h-20 w-full resize-y border border-line bg-paper p-3 text-xs" maxLength={1_000} onChange={(event) => setNotes((current) => ({ ...current, [work.id]: event.target.value }))} placeholder="메모 (선택)" value={notes[work.id] ?? ""} /><button className="mt-3 flex w-full items-center justify-center gap-2 bg-ink px-4 py-3 text-xs font-bold text-paper disabled:opacity-40" disabled={selected.length === 0 || Boolean(busyScope)} onClick={() => void releaseStoreItems(work)} type="button"><Send size={14} /> 선택 상품 출고 완료</button></div>
          </div>
        </article>;
      })}
      {!loading && storeWorks.length === 0 && <div className="border border-dashed border-line py-12 text-center text-sm text-muted">현재 매장에서 처리할 출고 작업이 없습니다.</div>}
    </section>

    <section className="space-y-5 border-t border-ink pt-8" aria-busy={loading}>
      <div><p className="eyebrow text-muted">중앙센터 수령 · 보관</p><h2 className="mt-2 text-xl font-black">중앙 물류 작업</h2><p className="mt-2 text-xs leading-5 text-muted">상품마다 원산지 매장과 전달 방식을 확인한 뒤 실제 입고와 보관 위치를 기록합니다.</p></div>
      {centerGroups.map(({ action, centerId, centerName, items }) => {
        const actionKey = centerActionKey(action, centerId);
        const selected = centerSelection[actionKey] ?? [];
        const selectable = items.filter((item) => !item.isBlocked).slice(0, 100);
        const allSelected = selectable.length > 0 && selectable.every((item) => selected.includes(item.inventoryItemId));
        const location = storageLocationCodes[actionKey] ?? "";
        return (
          <article className="border border-line" key={actionKey}>
            <div className="border-b border-line bg-surface p-5">
              <p className="text-sm font-black">{centerName} · {action === "receive" ? "입고 확인" : "보관 처리"}</p>
              <p className="mt-2 text-xs text-muted">{action === "receive" ? "이 센터로 이동 중인 상품의 실물 입고를 확인합니다." : "이 센터에 입고된 상품에 공통 보관 위치를 지정합니다."}</p>
            </div>
            <div className="p-5">
              {selectable.length > 0 && (
                <label className="flex items-center gap-2 border-b border-line pb-3 text-xs font-bold">
                  <input checked={allSelected} onChange={(event) => toggleCenterAll(action, centerId, items, event.target.checked)} type="checkbox" />
                  {centerName} 현재 단계 상품 전체 선택{items.length > 100 ? " (최대 100개)" : ""}
                </label>
              )}
              {items.map((item) => {
                const checked = selected.includes(item.inventoryItemId);
                const disabled = item.isBlocked || (!checked && selected.length >= 100);
                return (
                  <label className={`flex items-start gap-3 border-b border-line py-3 last:border-b-0 ${disabled ? "opacity-60" : "cursor-pointer"}`} key={item.inventoryItemId}>
                    <input checked={checked} disabled={disabled} onChange={(event) => setCenterSelection((current) => ({
                      ...current,
                      [actionKey]: event.target.checked
                        ? [...(current[actionKey] ?? []), item.inventoryItemId]
                        : (current[actionKey] ?? []).filter((id) => id !== item.inventoryItemId),
                    }))} type="checkbox" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{item.title}</span>
                      <span className="mt-1 block text-[11px] text-muted">{centerName} · {item.originStoreName} · {item.handoffMode} · {stageLabel[item.physicalStatus] ?? item.physicalStatus} · v{item.version}</span>
                      {item.storageLocationCode && <span className="mt-1 block text-[11px] text-muted">현재 위치 {item.storageLocationCode}</span>}
                      {item.isBlocked && <span className="mt-1 block text-[11px] text-rose-700">예외 또는 상품 확인 처리 중</span>}
                    </span>
                  </label>
                );
              })}
              <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                {action === "store" && <input aria-label={`${centerName} 보관 위치`} className="h-10 border border-line px-3 text-xs" maxLength={120} onChange={(event) => setStorageLocationCodes((current) => ({ ...current, [actionKey]: event.target.value }))} placeholder="보관 위치 (예: B-03-02)" value={location} />}
                <textarea aria-label={`${centerName} ${action === "receive" ? "입고" : "보관"} 메모`} className="min-h-10 resize-y border border-line p-3 text-xs" maxLength={1_000} onChange={(event) => setNotes((current) => ({ ...current, [`center:${actionKey}`]: event.target.value }))} placeholder="메모 (선택)" value={notes[`center:${actionKey}`] ?? ""} />
                <button className="flex items-center justify-center gap-2 bg-ink px-4 py-3 text-xs font-bold text-paper disabled:opacity-40" disabled={selected.length === 0 || Boolean(busyScope) || (action === "store" && !location.trim())} onClick={() => void recordCenterItems(action, centerId)} type="button">{action === "receive" ? <><Inbox size={14} /> 선택 상품 입고 확인</> : <><Archive size={14} /> 선택 상품 보관 완료</>}</button>
              </div>
            </div>
          </article>
        );
      })}
      {!loading && centerGroups.length === 0 && <div className="border border-dashed border-line py-12 text-center text-sm text-muted">현재 중앙센터에서 처리할 상품이 없습니다.</div>}
    </section>
  </div>;
}
