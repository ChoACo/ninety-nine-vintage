"use client";

import { CircleCheck, Clock3, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CatalogImage } from "@/components/ui/CatalogImage";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface Item {
  order_id: string;
  product_id: string;
  unit_price: number;
  payment_status: string;
  products?: { title: string; image_urls: string[] } | null;
  commerce_orders?: { member_id: string; total: number; status: string; created_at: string } | null;
}

interface LedgerEntry {
  id: string;
  entry_type: "receipt" | "reversal";
  amount: number;
  depositor_name: string | null;
  memo: string;
  created_at: string;
  reversal_of: string | null;
}

interface Transfer {
  id: string;
  order_id: string;
  status: string;
  expected_amount: number;
  receivedAmount: number;
  remainingAmount: number;
  bank_name_snapshot: string;
  requested_at: string;
  ledger: LedgerEntry[];
}

interface ReceiptForm {
  amount: string;
  depositorName: string;
  memo: string;
  reversalReason: string;
}

const emptyForm: ReceiptForm = { amount: "", depositorName: "", memo: "", reversalReason: "" };
const formatWon = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;

export function OperatorOrdersConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [forms, setForms] = useState<Record<string, ReceiptForm>>({});
  const [filter, setFilter] = useState({ search: "", status: "all" });
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (accessToken: string | null) => {
    if (!accessToken) return;
    const response = await fetch("/api/operator/orders", { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const payload = await response.json() as { items?: Item[]; transfers?: Transfer[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "주문을 불러오지 못했습니다.");
    setItems(payload.items ?? []);
    setTransfers(payload.transfers ?? []);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
        setToken(session?.access_token ?? null);
        if (session) await load(session.access_token);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "주문을 불러오지 못했습니다.");
      }
    })();
  }, [load]);

  const orders = useMemo(() => transfers.map((transfer) => ({
    transfer,
    lines: items.filter((item) => item.order_id === transfer.order_id),
  })).filter(({ transfer, lines }) => {
    const query = filter.search.trim().toLowerCase();
    const text = [transfer.order_id, lines[0]?.commerce_orders?.member_id ?? "", ...lines.map((line) => line.products?.title ?? "")].join(" ").toLowerCase();
    return (!query || text.includes(query)) && (filter.status === "all" || transfer.status === filter.status);
  }), [filter, items, transfers]);

  const updateForm = (id: string, patch: Partial<ReceiptForm>) => {
    setForms((current) => ({ ...current, [id]: { ...(current[id] ?? emptyForm), ...patch } }));
  };

  const mutateLedger = async (transfer: Transfer, body: Record<string, unknown>) => {
    if (!token || busy) return;
    setBusy(transfer.id);
    setNotice("");
    try {
      const response = await fetch(`/api/operator/transfers/${transfer.id}/ledger`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "입금 원장을 갱신하지 못했습니다.");
      setForms((current) => ({ ...current, [transfer.id]: emptyForm }));
      setNotice(body.action === "reverse" ? "취소 원장을 추가했습니다." : "입금 영수증을 기록했습니다.");
      await load(token);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "입금 원장을 갱신하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const waiting = transfers.filter((transfer) => transfer.remainingAmount > 0).length;
  const settled = transfers.filter((transfer) => transfer.status === "confirmed").length;

  return <div className="space-y-8">
    <div className="flex items-end justify-between border-b border-ink pb-6">
      <div><p className="eyebrow text-muted">OPERATOR / ORDERS</p><h1 className="mt-3 text-4xl font-black tracking-[-.08em]">입금·주문 처리</h1><p className="mt-3 text-sm text-muted">입금액을 부분 기록하고 잔액이 0원일 때만 주문을 결제 완료로 전환합니다.</p></div>
      <button className="flex items-center gap-2 border border-line px-4 py-3 text-xs font-bold" onClick={() => void load(token).catch((error) => setNotice(error instanceof Error ? error.message : "새로고침에 실패했습니다."))} type="button"><RefreshCw size={13} /> 새로고침</button>
    </div>
    {notice && <div aria-live="polite" className="border border-line bg-surface px-4 py-3 text-xs">{notice}</div>}
    <div className="grid grid-cols-3 gap-4">
      <div className="border border-line p-5"><Clock3 size={17} /><p className="mt-7 text-xs text-muted">잔액 입금 대기</p><p className="mt-2 font-mono text-3xl font-bold">{waiting}</p></div>
      <div className="border border-line p-5"><CircleCheck size={17} /><p className="mt-7 text-xs text-muted">입금 확인 완료</p><p className="mt-2 font-mono text-3xl font-bold">{settled}</p></div>
      <div className="border border-line bg-ink p-5 text-paper"><p className="eyebrow text-zinc-400">ORDER LINES</p><p className="mt-7 font-mono text-3xl font-bold">{items.length}</p><p className="mt-2 text-xs text-zinc-400">내 숍 상품 라인</p></div>
    </div>
    <div className="flex gap-3"><div className="flex flex-1 items-center gap-2 border border-line bg-paper px-3"><Search size={14} className="text-muted" /><input aria-label="주문 검색" className="h-11 w-full bg-transparent text-xs outline-none" onChange={(event) => setFilter({ ...filter, search: event.target.value })} placeholder="주문번호·회원 ID·상품명 검색" value={filter.search} /></div><select aria-label="주문 상태 필터" className="w-48 border border-line bg-paper px-3 text-xs" onChange={(event) => setFilter({ ...filter, status: event.target.value })} value={filter.status}><option value="all">전체 상태</option><option value="awaiting_transfer">입금 대기</option><option value="partially_paid">부분 입금</option><option value="confirmed">입금 확인</option></select></div>
    <div className="divide-y divide-line border-y border-line">{orders.map(({ transfer, lines }) => {
      const form = forms[transfer.id] ?? emptyForm;
      return <article className="py-6" key={transfer.id}>
        <div className="flex items-start justify-between gap-6"><div><p className="text-sm font-bold">주문 {transfer.order_id}</p><p className="mt-1 text-xs text-muted">{lines[0]?.commerce_orders?.member_id ?? "회원 미상"} · {new Date(transfer.requested_at).toLocaleString("ko-KR")} · {transfer.bank_name_snapshot}</p></div><div className="text-right"><p className="font-mono text-sm font-bold">{formatWon(transfer.expected_amount)}</p><p className="mt-1 text-[10px] text-muted">누적 {formatWon(transfer.receivedAmount)} · 잔액 {formatWon(transfer.remainingAmount)}</p></div></div>
        <div className="mt-4 divide-y divide-line border-y border-line">{lines.map((line) => <div className="flex items-center gap-3 py-3" key={line.product_id}><CatalogImage alt="" className="size-12 object-cover" src={line.products?.image_urls?.[0] ?? ""} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">{line.products?.title ?? line.product_id}</p><p className="mt-1 text-[10px] text-muted">{line.payment_status} · {formatWon(line.unit_price)}</p></div></div>)}</div>
        {transfer.remainingAmount > 0 && <div className="mt-4 grid grid-cols-[140px_150px_1fr_auto] gap-2"><input aria-label={`${transfer.order_id} 입금액`} className="h-10 border border-line px-3 text-xs" inputMode="numeric" onChange={(event) => updateForm(transfer.id, { amount: event.target.value })} placeholder={`최대 ${formatWon(transfer.remainingAmount)}`} value={form.amount} /><input aria-label={`${transfer.order_id} 입금자명`} className="h-10 border border-line px-3 text-xs" onChange={(event) => updateForm(transfer.id, { depositorName: event.target.value })} placeholder="입금자명" value={form.depositorName} /><input aria-label={`${transfer.order_id} 메모`} className="h-10 border border-line px-3 text-xs" onChange={(event) => updateForm(transfer.id, { memo: event.target.value })} placeholder="메모 (선택)" value={form.memo} /><button className="border border-ink px-4 text-xs font-bold disabled:opacity-40" disabled={busy === transfer.id || !form.amount || !form.depositorName} onClick={() => void mutateLedger(transfer, { action: "record", kind: "commerce", amount: Number(form.amount.replaceAll(",", "")), depositorName: form.depositorName, memo: form.memo })} type="button">입금 기록</button></div>}
        {transfer.ledger.length > 0 && <div className="mt-4 space-y-2 border-l-2 border-line pl-4">{transfer.ledger.map((entry) => <div className="flex items-center justify-between gap-4 text-[11px]" key={entry.id}><span>{entry.entry_type === "receipt" ? `입금 ${formatWon(entry.amount)} · ${entry.depositor_name}` : `취소 ${formatWon(entry.amount)} · ${entry.memo}`} · {new Date(entry.created_at).toLocaleString("ko-KR")}</span>{entry.entry_type === "receipt" && !transfer.ledger.some((candidate) => candidate.reversal_of === entry.id) && <button className="underline disabled:opacity-40" disabled={busy === transfer.id} onClick={() => { const reason = window.prompt("입금 기록 취소 사유를 입력하세요."); if (reason) void mutateLedger(transfer, { action: "reverse", ledgerId: entry.id, reason }); }} type="button">취소 원장 추가</button>}</div>)}</div>}
      </article>;
    })}{orders.length === 0 && <p className="py-16 text-center text-sm text-muted">조건에 맞는 주문이 없습니다.</p>}</div>
  </div>;
}
