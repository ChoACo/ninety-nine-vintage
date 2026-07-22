"use client";

import { PackageCheck, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface FulfillmentItem {
  orderItemId: string;
  productId: string;
  title: string;
  imageUrl: string | null;
  paymentStatus: string;
  stage: string;
  locationKind: string;
  storageLocationCode: string | null;
  isBlocked: boolean;
  blockReason: string | null;
  version: number;
  updatedAt: string;
}

interface StoreWork {
  work_id: string;
  order_id: string;
  store_id: string;
  store_name: string;
  business_id: string;
  work_status: string;
  work_version: number;
  order_status: string;
  order_created_at: string;
  center_id: string;
  center_name: string;
  center_status: string;
  center_postal_code: string | null;
  center_address_line1: string | null;
  center_address_line2: string | null;
  center_contact_name: string | null;
  center_contact_phone: string | null;
  active_item_count: number;
  blocked_item_count: number;
  items: FulfillmentItem[];
}

interface QueuePayload {
  works?: StoreWork[];
  error?: string;
  message?: string;
}

const statusLabels: Record<string, string> = {
  waiting_payment: "입금 확인 전",
  preparing: "상품 준비 중",
  ready_for_transfer: "중앙 인계 준비 완료",
  in_transit_to_center: "중앙으로 이동 중",
  partially_received: "일부 입고 확인",
  center_received: "중앙 입고 완료",
  issue: "확인 필요한 상품 있음",
};

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "주문 시각 미확인" : date.toLocaleString("ko-KR");
}

export function OperatorFulfillmentConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [works, setWorks] = useState<StoreWork[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyWorkId, setBusyWorkId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const load = useCallback(async (accessToken: string) => {
    const response = await fetch("/api/admin/operator/fulfillment", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const payload = await response.json() as QueuePayload;
    if (!response.ok) {
      throw new Error(payload.message ?? "매장 물류 목록을 불러오지 못했습니다.");
    }
    setWorks(Array.isArray(payload.works) ? payload.works : []);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
        if (!session) {
          setNotice("운영 계정으로 로그인해 주세요.");
          return;
        }
        setToken(session.access_token);
        await load(session.access_token);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "매장 물류 목록을 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  const refresh = async () => {
    if (!token) return;
    setLoading(true);
    setNotice("");
    try {
      await load(token);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "새로고침하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const advance = async (work: StoreWork, action: "mark_ready" | "hand_over") => {
    if (!token || busyWorkId) return;
    setBusyWorkId(work.work_id);
    setNotice("");
    try {
      const response = await fetch("/api/admin/operator/fulfillment", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workId: work.work_id,
          expectedVersion: work.work_version,
          action,
          idempotencyKey: crypto.randomUUID(),
          note: notes[work.work_id]?.trim() || null,
        }),
      });
      const payload = await response.json() as QueuePayload;
      if (!response.ok) {
        if (response.status === 409) {
          await load(token);
          throw new Error("다른 담당자가 먼저 변경했습니다. 최신 목록으로 새로고침했습니다.");
        }
        throw new Error(payload.message ?? "매장 물류 작업을 저장하지 못했습니다.");
      }
      setNotice(action === "mark_ready" ? "상품 준비 완료를 저장했습니다." : "중앙 출고지 인계를 저장했습니다.");
      setNotes((current) => ({ ...current, [work.work_id]: "" }));
      await load(token);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "매장 물류 작업을 저장하지 못했습니다.");
    } finally {
      setBusyWorkId(null);
    }
  };

  const preparingCount = works.filter((work) => work.work_status === "preparing").length;
  const readyCount = works.filter((work) => work.work_status === "ready_for_transfer").length;

  return (
    <div className="space-y-8">
      <header className="flex flex-col items-stretch justify-between gap-5 border-b border-ink pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow text-muted">운영자 / 매장 출고</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-.06em] sm:text-4xl sm:tracking-[-.08em]">중앙 출고 준비</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">입금이 확인된 상품을 준비한 뒤, 실제로 중앙 출고지에 넘긴 순서대로 기록합니다.</p>
        </div>
        <button
          className="flex items-center justify-center gap-2 border border-line px-4 py-3 text-xs font-bold disabled:opacity-40"
          disabled={!token || loading}
          onClick={() => void refresh()}
          type="button"
        >
          <RefreshCw size={14} /> 새로고침
        </button>
      </header>

      {notice && <div aria-live="polite" className="border border-line bg-surface px-4 py-3 text-sm">{notice}</div>}

      <div className="grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-3">
        <div className="bg-paper p-5"><p className="text-xs text-muted">상품 준비 중</p><p className="mt-3 font-mono text-3xl font-bold">{preparingCount}</p></div>
        <div className="bg-paper p-5"><p className="text-xs text-muted">중앙 인계 대기</p><p className="mt-3 font-mono text-3xl font-bold">{readyCount}</p></div>
        <div className="bg-ink p-5 text-paper"><p className="text-xs text-zinc-400">현재 작업 상품</p><p className="mt-3 font-mono text-3xl font-bold">{works.reduce((sum, work) => sum + Number(work.active_item_count), 0)}</p></div>
      </div>

      <section className="space-y-4" aria-busy={loading}>
        {works.map((work) => {
          const canAdvance = work.center_status === "active";
          const isBusy = busyWorkId === work.work_id;
          return (
            <article className="border border-line" key={work.work_id}>
              <div className="flex flex-col justify-between gap-4 border-b border-line bg-surface p-5 sm:flex-row sm:items-start">
                <div className="min-w-0">
                  <p className="text-sm font-black">{work.store_name} · {statusLabels[work.work_status] ?? work.work_status}</p>
                  <p className="mt-2 break-all text-[11px] text-muted">주문 {work.order_id} · {dateLabel(work.order_created_at)}</p>
                </div>
                <span className="w-fit border border-line bg-paper px-3 py-1 text-[10px] font-bold">상품 {work.active_item_count}개</span>
              </div>

              <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]">
                <div className="space-y-3">
                  {work.items.map((item) => (
                    <div className="flex items-start justify-between gap-4 border-b border-line pb-3 last:border-b-0" key={item.orderItemId}>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">{item.title}</p>
                        <p className="mt-1 text-[11px] text-muted">{statusLabels[item.stage] ?? item.stage}</p>
                      </div>
                      {item.isBlocked && <span className="shrink-0 border border-rose-300 px-2 py-1 text-[10px] font-bold text-rose-700">확인 필요</span>}
                    </div>
                  ))}
                </div>

                <div className="border border-line p-4">
                  <p className="text-xs font-bold">인계할 중앙 출고지</p>
                  <p className="mt-2 text-sm">{work.center_name}</p>
                  {canAdvance ? (
                    <p className="mt-2 text-xs leading-5 text-muted">[{work.center_postal_code}] {work.center_address_line1}{work.center_address_line2 ? ` ${work.center_address_line2}` : ""}<br />{work.center_contact_name} · {work.center_contact_phone}</p>
                  ) : (
                    <p className="mt-2 text-xs leading-5 text-amber-700">소유자가 중앙 출고지의 실제 주소를 설정한 뒤 작업할 수 있습니다.</p>
                  )}
                  {(work.work_status === "preparing" || work.work_status === "ready_for_transfer") && (
                    <>
                      <textarea
                        aria-label={`${work.store_name} 작업 메모`}
                        className="mt-4 min-h-20 w-full resize-y border border-line bg-paper p-3 text-xs outline-none focus:border-ink"
                        maxLength={1_000}
                        onChange={(event) => setNotes((current) => ({ ...current, [work.work_id]: event.target.value }))}
                        placeholder="필요한 메모 (선택)"
                        value={notes[work.work_id] ?? ""}
                      />
                      {work.work_status === "preparing" ? (
                        <button
                          className="mt-3 flex w-full items-center justify-center gap-2 bg-ink px-4 py-3 text-xs font-bold text-paper disabled:opacity-40"
                          disabled={!canAdvance || Boolean(busyWorkId)}
                          onClick={() => void advance(work, "mark_ready")}
                          type="button"
                        >
                          <PackageCheck size={15} /> {isBusy ? "저장 중" : "모든 상품 준비 완료"}
                        </button>
                      ) : (
                        <button
                          className="mt-3 flex w-full items-center justify-center gap-2 bg-ink px-4 py-3 text-xs font-bold text-paper disabled:opacity-40"
                          disabled={!canAdvance || Boolean(busyWorkId)}
                          onClick={() => void advance(work, "hand_over")}
                          type="button"
                        >
                          <Send size={15} /> {isBusy ? "저장 중" : "중앙 출고지에 인계함"}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </article>
          );
        })}

        {!loading && works.length === 0 && (
          <div className="border border-dashed border-line py-16 text-center text-sm text-muted">현재 처리할 매장 출고 작업이 없습니다.</div>
        )}
        {loading && works.length === 0 && <div className="py-16 text-center text-sm text-muted">매장 물류 목록을 불러오는 중입니다.</div>}
      </section>
    </div>
  );
}
