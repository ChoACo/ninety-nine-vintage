"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

type ViewTab = "sales" | "settlement";
type SaleFilter = "all" | "progress" | "completed" | "cancelled";
type ShipmentItem = { inventoryItemId: string; productId: string; title: string; imageUrl: string | null; lineStatus: string; originStoreId: string };
type Shipment = { id: string; status: string; version: number; requestedAt: string; packedAt: string | null; shippedAt: string | null; courier: string | null; trackingNumber: string | null; memberName: string; items: ShipmentItem[] };
type RevenueEntry = { id: string; entryKind: "item_payment" | "item_refund" | "payment_reversal"; amount: number; occurredAt: string; inventoryItemId: string | null; productId: string | null; productTitle: string | null; productImageUrl: string | null; settlementStatus: "pending" | "paid" | null; settlementEligibleAt: string | null; settlementDate: string | null; settledAt: string | null };
type SaleRow = { id: string; date: string; status: SaleFilter; statusLabel: string; title: string; imageUrl: string | null; amount: number; shipment?: Shipment; action?: "pack" | "ship" | "tracking_update" };

const FILTERS: Array<[SaleFilter, string]> = [["all", "전체"], ["progress", "진행중"], ["completed", "판매완료"], ["cancelled", "취소/환불"]];
const COURIERS = ["CJ대한통운", "한진택배", "롯데택배", "로젠택배", "우체국택배", "기타"];

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "날짜 확인 필요" : new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeZone: "Asia/Seoul" }).format(date);
}

function saleState(shipment?: Shipment): Pick<SaleRow, "status" | "statusLabel" | "action"> {
  if (!shipment) return { status: "progress", statusLabel: "결제 완료 · 배송 요청 대기" };
  if (shipment.status === "ready_to_pack") return { status: "progress", statusLabel: "상품 준비 중", action: "pack" };
  if (shipment.status === "packed") return { status: "progress", statusLabel: "상품 준비 완료", action: "ship" };
  if (shipment.status === "shipped") return { status: "completed", statusLabel: "배송 중 · 정산 대기", action: "tracking_update" };
  return { status: "progress", statusLabel: "상품 준비 대기" };
}

export function OperatorSalesConsole() {
  const { session } = useSupabaseSession();
  const token = session?.access_token ?? null;
  const [view, setView] = useState<ViewTab>("sales");
  const [filter, setFilter] = useState<SaleFilter>("all");
  const [query, setQuery] = useState("");
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [entries, setEntries] = useState<RevenueEntry[]>([]);
  const [modalShipment, setModalShipment] = useState<Shipment | null>(null);
  const [courier, setCourier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    setNotice("");
    const now = new Date();
    const fromDate = new Date(now);
    fromDate.setUTCFullYear(fromDate.getUTCFullYear() - 1);
    const to = now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
    const from = fromDate.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [shippingResponse, revenueResponse] = await Promise.all([
        fetch("/api/admin/operator/shipping?includeShipped=true&limit=100&offset=0", { headers, cache: "no-store" }),
        fetch(`/api/admin/operator/revenue?from=${from}&to=${to}`, { headers, cache: "no-store" }),
      ]);
      const shippingPayload = await shippingResponse.json().catch(() => null) as { shipments?: Shipment[]; message?: string } | null;
      const revenuePayload = await revenueResponse.json().catch(() => null) as { stores?: Array<{ entries?: RevenueEntry[] }>; message?: string } | null;
      if (!shippingResponse.ok) throw new Error(shippingPayload?.message ?? "배송 상품을 불러오지 못했습니다.");
      if (!revenueResponse.ok) throw new Error(revenuePayload?.message ?? "판매 내역을 불러오지 못했습니다.");
      setShipments(shippingPayload?.shipments ?? []);
      setEntries((revenuePayload?.stores ?? []).flatMap((store) => store.entries ?? []));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "거래 내역을 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }, [token]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const sales = useMemo<SaleRow[]>(() => {
    const shipmentByInventory = new Map<string, Shipment>();
    for (const shipment of shipments) for (const item of shipment.items) shipmentByInventory.set(item.inventoryItemId, shipment);
    const rows: SaleRow[] = [];
    for (const entry of entries) {
      if (entry.entryKind === "item_payment") {
        if (entry.settlementStatus === "paid") continue;
        const shipment = entry.inventoryItemId ? shipmentByInventory.get(entry.inventoryItemId) : undefined;
        rows.push({ id: entry.id, date: entry.occurredAt, title: entry.productTitle ?? "상품 정보 확인", imageUrl: entry.productImageUrl, amount: entry.amount, shipment, ...saleState(shipment) });
      } else {
        rows.push({ id: entry.id, date: entry.occurredAt, status: "cancelled", statusLabel: "취소·환불", title: entry.productTitle ?? "상품 정보 확인", imageUrl: entry.productImageUrl, amount: Math.abs(entry.amount) });
      }
    }
    return rows.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  }, [entries, shipments]);

  const settlements = useMemo(() => entries.filter((entry) => entry.entryKind === "item_payment" && entry.settlementStatus === "paid").sort((a, b) => Date.parse(b.settledAt ?? b.occurredAt) - Date.parse(a.settledAt ?? a.occurredAt)), [entries]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = sales.filter((row) => (filter === "all" || row.status === filter) && row.title.toLowerCase().includes(normalizedQuery));

  const runPack = async (shipment: Shipment) => {
    if (!token) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/operator/shipping", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ shipmentId: shipment.id, expectedVersion: shipment.version, action: "pack", idempotencyKey: crypto.randomUUID(), note: null }) });
      const payload = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(payload?.message ?? "상품 준비를 완료하지 못했습니다.");
      setNotice("상품 준비를 완료했습니다. 이제 송장번호를 입력할 수 있습니다.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "상품 준비를 완료하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const openTracking = (shipment: Shipment) => {
    setModalShipment(shipment);
    setCourier(shipment.courier ?? "");
    setTrackingNumber(shipment.trackingNumber ?? "");
    setNote("");
  };

  const saveTracking = async () => {
    if (!token || !modalShipment || !courier.trim() || !trackingNumber.trim()) return;
    const updating = modalShipment.status === "shipped";
    if (updating && note.trim().length < 3) {
      setNotice("송장 수정 사유를 3자 이상 입력해 주세요.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/operator/shipping", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ shipmentId: modalShipment.id, expectedVersion: modalShipment.version, action: updating ? "tracking_update" : "ship", courier: courier.trim(), trackingNumber: trackingNumber.trim(), note: updating ? note.trim() : null, idempotencyKey: crypto.randomUUID() }) });
      const payload = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(payload?.message ?? "송장 정보를 저장하지 못했습니다.");
      setModalShipment(null);
      setNotice(updating ? "송장 정보를 수정했습니다." : "송장을 등록하고 배송 중으로 변경했습니다.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "송장 정보를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="mx-auto max-w-5xl space-y-6">
    <header className="flex items-end justify-between border-b border-ink pb-5"><div><p className="eyebrow text-muted">판매센터</p><h1 className="mt-2 text-3xl font-black tracking-[-.07em]">거래내역</h1></div><button className="text-sm font-black underline" onClick={() => setView("settlement")} type="button">정산내역</button></header>
    <div className="grid grid-cols-2 border-b border-line"><button className={`min-h-14 border-b-4 text-lg font-black ${view === "sales" ? "border-ink" : "border-transparent text-muted"}`} onClick={() => setView("sales")} type="button">판매내역</button><button className={`min-h-14 border-b-4 text-lg font-black ${view === "settlement" ? "border-ink" : "border-transparent text-muted"}`} onClick={() => setView("settlement")} type="button">정산내역</button></div>
    {notice && <p className="border border-line bg-surface p-3 text-sm font-bold" role="status">{notice}</p>}
    {view === "sales" ? <>
      <div className="flex gap-2 overflow-x-auto pb-1">{FILTERS.map(([value, label]) => <button className={`shrink-0 rounded-full border px-5 py-3 text-sm font-black ${filter === value ? "border-ink bg-ink text-paper" : "border-line bg-paper text-muted"}`} key={value} onClick={() => setFilter(value)} type="button">{label}</button>)}</div>
      <div className="flex gap-3"><label className="flex min-h-12 flex-1 items-center gap-2 rounded-xl bg-surface px-4"><Search size={18} className="text-muted"/><input className="min-w-0 flex-1 bg-transparent text-sm outline-none" onChange={(event) => setQuery(event.target.value)} placeholder="상품명으로 검색해 보세요" value={query}/></label><button aria-label="필터" className="grid size-12 place-items-center rounded-xl border border-line" type="button"><SlidersHorizontal size={18}/></button></div>
      <div className="space-y-4">{visibleRows.map((row) => <article className="rounded-2xl border border-line bg-paper p-5" key={row.id}><p className="text-lg font-black">{dateLabel(row.date)}</p><div className="my-4 border-t border-line"/><p className="text-base font-black">{row.statusLabel}</p><div className="mt-4 flex gap-4"><CatalogImage alt="" className="size-24 rounded-xl object-cover" sizes="96px" src={row.imageUrl ?? ""}/><div className="min-w-0 flex-1"><p className="text-xl font-black">{row.amount.toLocaleString("ko-KR")}원</p><p className="mt-2 truncate text-sm text-muted">{row.title}</p></div></div>{row.action === "pack" && row.shipment && <button className="mt-5 min-h-12 w-full rounded-xl bg-ink text-sm font-black text-paper disabled:opacity-40" disabled={busy} onClick={() => void runPack(row.shipment as Shipment)} type="button">상품 준비하기</button>}{row.action === "ship" && row.shipment && <button className="mt-5 min-h-12 w-full rounded-xl border border-ink text-sm font-black" onClick={() => openTracking(row.shipment as Shipment)} type="button">송장번호 입력하기</button>}{row.action === "tracking_update" && row.shipment && <button className="mt-5 min-h-12 w-full rounded-xl border border-line text-sm font-black" onClick={() => openTracking(row.shipment as Shipment)} type="button">송장번호 수정하기</button>}</article>)}{!busy && visibleRows.length === 0 && <p className="rounded-2xl border border-dashed border-line py-16 text-center text-sm text-muted">조건에 맞는 판매 내역이 없습니다.</p>}</div>
    </> : <div className="space-y-4">{settlements.map((entry) => <article className="rounded-2xl border border-line bg-paper p-5" key={entry.id}><p className="text-lg font-black">{dateLabel(entry.settledAt ?? entry.settlementDate ?? entry.occurredAt)}</p><div className="my-4 border-t border-line"/><div className="flex gap-4"><CatalogImage alt="" className="size-20 rounded-xl object-cover" sizes="80px" src={entry.productImageUrl ?? ""}/><div className="min-w-0 flex-1"><p className="text-lg font-black">{entry.amount.toLocaleString("ko-KR")}원</p><p className="mt-1 truncate text-sm text-muted">{entry.productTitle ?? "정산 상품"}</p><p className="mt-2 text-xs font-bold">정산 완료</p></div></div></article>)}{!busy && settlements.length === 0 && <p className="rounded-2xl border border-dashed border-line py-16 text-center text-sm text-muted">완료된 정산 내역이 없습니다.</p>}</div>}
    {modalShipment && <div aria-modal="true" className="fixed inset-0 z-[150] grid place-items-center bg-black/55 p-4" role="dialog"><div className="w-full max-w-md rounded-2xl bg-paper p-6 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-xl font-black">{modalShipment.status === "shipped" ? "송장번호 수정" : "송장 정보 입력"}</h2><button aria-label="닫기" onClick={() => setModalShipment(null)} type="button"><X size={20}/></button></div><div className="mt-5 space-y-3"><select aria-label="택배사 선택" className="h-12 w-full rounded-xl border border-line bg-paper px-4" onChange={(event) => setCourier(event.target.value)} value={courier}><option value="">택배사 선택</option>{COURIERS.map((value) => <option key={value} value={value}>{value}</option>)}</select><input className="h-12 w-full rounded-xl border border-line px-4 font-mono" onChange={(event) => setTrackingNumber(event.target.value)} placeholder="송장번호 입력" value={trackingNumber}/>{modalShipment.status === "shipped" && <input className="h-12 w-full rounded-xl border border-line px-4" onChange={(event) => setNote(event.target.value)} placeholder="수정 사유 3자 이상" value={note}/>}<button className="h-12 w-full rounded-xl bg-ink font-black text-paper disabled:opacity-40" disabled={busy || !courier.trim() || !trackingNumber.trim() || (modalShipment.status === "shipped" && note.trim().length < 3)} onClick={() => void saveTracking()} type="button">완료</button></div></div></div>}
  </div>;
}
