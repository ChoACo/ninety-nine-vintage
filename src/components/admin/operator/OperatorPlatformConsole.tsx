"use client";

import { useCallback, useEffect, useState } from "react";

import { useSupabaseSession } from "@/hooks/useSupabaseSession";

type Store = {
  id: string;
  name: string;
  planCode: string;
  requestedPlanCode: string | null;
  subscriptionStatus: string;
  monthlyFee: number;
  aiUsed: number;
  productsCreated: number;
  totalSettlementSales: number;
  weeklySales: number;
  nextSettlementEstimate: number;
  regularShippingFee: number | null;
  remoteAreaShippingFee: number | null;
  paidTotal: number;
  payoutAccount: {
    bankName: string;
    accountHolder: string;
    accountNumberMasked: string;
    status: string;
  } | null;
  settlements: Array<{
    id: string;
    settlementDate: string;
    payoutAmount: number;
    status: string;
  }>;
  settlementEntries: Array<{
    id: string;
    kind: string;
    amount: number;
    eligibleAt: string;
    batchId: string | null;
  }>;
};

function ShippingFeeEditor({ store, save }: { store: Store; save: (body: Record<string, unknown>) => Promise<void> }) {
  const [regular, setRegular] = useState(String(store.regularShippingFee ?? ""));
  const [remote, setRemote] = useState(String(store.remoteAreaShippingFee ?? ""));
  const valid = Number.isSafeInteger(Number(regular)) && Number(regular) > 0
    && Number.isSafeInteger(Number(remote)) && Number(remote) >= Number(regular);
  return <div className="mt-5 border-t border-line pt-4">
    <h3 className="text-xs font-black">센터 택배비 설정</h3>
    <p className="mt-1 text-[10px] text-muted">일반 택배와 제주 및 도서산간 지역 택배 2개만 설정합니다.</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
      <label className="text-[10px] font-bold">일반 택배<input className="mt-1 w-full border border-line bg-paper p-2 text-xs" min="1" onChange={(e) => setRegular(e.target.value)} type="number" value={regular} /></label>
      <label className="text-[10px] font-bold">제주 및 도서산간<input className="mt-1 w-full border border-line bg-paper p-2 text-xs" min={Number(regular) || 1} onChange={(e) => setRemote(e.target.value)} type="number" value={remote} /></label>
      <button className="self-end bg-ink p-2 text-xs font-bold text-paper disabled:opacity-40" disabled={!valid} onClick={() => void save({ action: "save_shipping_fees", storeId: store.id, regularShippingFee: Number(regular), remoteAreaShippingFee: Number(remote) })} type="button">택배비 저장</button>
    </div>
  </div>;
}

export function OperatorPlatformConsole() {
  const { session } = useSupabaseSession();
  const token = session?.access_token ?? null;
  const [stores, setStores] = useState<Store[]>([]);
  const [message, setMessage] = useState("");
  const [bank, setBank] = useState("");
  const [holder, setHolder] = useState("");
  const [account, setAccount] = useState("");

  const load = useCallback(async () => {
    if (!token) return setMessage("로그인 세션을 확인해 주세요.");
    const response = await fetch("/api/admin/operator/platform", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const payload = await response.json();
    if (response.ok) setStores(payload.management?.stores ?? []);
    else setMessage(payload.error ?? "조회 실패");
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load, token]);

  async function action(body: Record<string, unknown>) {
    if (!token) return setMessage("로그인 세션을 확인해 주세요.");
    setMessage("처리 중…");
    const response = await fetch("/api/admin/operator/platform", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    setMessage(response.ok ? "저장했습니다." : payload.error ?? "처리 실패");
    if (response.ok) await load();
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-black">센터 등급·정산</h1>
        <p className="mt-2 text-sm text-muted">센터마다 이용 한도와 정산계좌를 독립 관리합니다.</p>
      </header>
      <section className="grid gap-3 md:grid-cols-2">
        <article className="border border-line p-4 text-xs">
          <h2 className="font-black">기본 3만원</h2>
          <p className="mt-2 leading-5 text-muted">즉시 공개 하루 30개 · 예약 공개 하루 40개 · 초안과 예약 대기 합계 100개</p>
        </article>
        <article className="border border-ink bg-surface p-4 text-xs">
          <h2 className="font-black">프리미엄 5만원</h2>
          <p className="mt-2 leading-5 text-muted">각 한도 2배 · 승인된 자동화 프로그램 최근 7일 300개</p>
          <p className="mt-2 text-[10px] text-muted">소유자 승인일부터 적용되며 다음 청구일 전 변경·해지를 요청할 수 있습니다. 승인·거절·변경은 감사 기록에 남습니다.</p>
        </article>
      </section>
      {message && <p className="border border-line p-3 text-xs">{message}</p>}
      {stores.map((store) => (
        <section className="border border-line bg-surface p-5" key={store.id}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-black">{store.name}</h2>
              <p className="text-xs text-muted">{store.planCode} · 대기 상품 {store.productsCreated}개 · {store.subscriptionStatus}</p>
            </div>
            <div className="flex gap-2">
              <button className="border border-ink px-3 py-2 text-xs font-bold" onClick={() => void action({ action: "request_plan", storeId: store.id, planCode: "pro" })} type="button">프리미엄 5만원 신청</button>
            </div>
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-4">
            <input className="border border-line bg-paper p-2 text-xs" onChange={(event) => setBank(event.target.value)} placeholder="은행명" value={bank} />
            <input className="border border-line bg-paper p-2 text-xs" onChange={(event) => setHolder(event.target.value)} placeholder="예금주" value={holder} />
            <input className="border border-line bg-paper p-2 text-xs" onChange={(event) => setAccount(event.target.value)} placeholder="계좌번호" value={account} />
            <button className="bg-ink p-2 text-xs font-bold text-paper" onClick={() => void action({ action: "submit_payout_account", storeId: store.id, bankName: bank, accountHolder: holder, accountNumber: account })} type="button">정산계좌 제출</button>
          </div>
          {store.payoutAccount && <p className="mt-2 text-xs text-muted">{store.payoutAccount.bankName} {store.payoutAccount.accountNumberMasked} · {store.payoutAccount.status}</p>}
          <ShippingFeeEditor save={action} store={store} />
          <div className="mt-5 grid gap-2 sm:grid-cols-4">
            <p className="border border-line p-3 text-xs">총 정산 매출<br /><strong>{store.totalSettlementSales.toLocaleString("ko-KR")}원</strong></p>
            <p className="border border-line p-3 text-xs">이번 주 매출<br /><strong>{store.weeklySales.toLocaleString("ko-KR")}원</strong></p>
            <p className="border border-line p-3 text-xs">다음 정산 예정<br /><strong>{store.nextSettlementEstimate.toLocaleString("ko-KR")}원</strong></p>
            <p className="border border-line p-3 text-xs">지급 완료<br /><strong>{store.paidTotal.toLocaleString("ko-KR")}원</strong></p>
          </div>
          <div className="mt-5 space-y-2">
            <h3 className="text-xs font-black">정산 내역</h3>
            {store.settlements.length ? store.settlements.map((batch) => <div className="flex justify-between border-t border-line pt-2 text-xs" key={batch.id}><span>{batch.settlementDate} · {batch.status}</span><strong>{batch.payoutAmount.toLocaleString("ko-KR")}원</strong></div>) : <p className="text-xs text-muted">아직 정산 내역이 없습니다.</p>}
          </div>
          <details className="mt-5 border-t border-line pt-3 text-xs">
            <summary className="cursor-pointer font-black">상세 원장</summary>
            <div className="mt-2 space-y-1">
              {store.settlementEntries.length ? store.settlementEntries.map((entry) => (
                <div className="flex justify-between gap-3" key={entry.id}>
                  <span>{new Date(entry.eligibleAt).toLocaleString("ko-KR")} · {entry.kind}</span>
                  <strong>{entry.amount.toLocaleString("ko-KR")}원</strong>
                </div>
              )) : <p className="text-muted">정산 원장이 없습니다.</p>}
            </div>
          </details>
        </section>
      ))}
    </div>
  );
}
