"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

interface BidItem {
  id: string;
  productId: string;
  title: string;
  imageUrl: string;
  amount: number;
  currentPrice: number;
  closesAt: string;
  state: "leading" | "final" | "outbid" | "closed";
  createdAt: string;
}

interface BidPayload {
  items?: BidItem[];
  summary?: { total: number; leading: number; final: number; outbid: number };
}

const stateLabels: Record<BidItem["state"], string> = {
  leading: "현재 최고 입찰",
  final: "낙찰·결제 확인",
  outbid: "상위 입찰 필요",
  closed: "경매 종료",
};

export function BidHistory() {
  const { loading, revision, session } = useSupabaseSession();
  const [result, setResult] = useState<{
    revision: number;
    userId: string;
    payload: BidPayload;
  } | null>(null);

  useEffect(() => {
    if (!session?.access_token) return;
    const userId = session.user.id;
    const sessionRevision = revision;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/account/bids", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.ok) {
          const payload = await response.json() as BidPayload;
          if (!controller.signal.aborted) {
            setResult({ revision: sessionRevision, userId, payload });
          }
        } else if (!controller.signal.aborted) {
          setResult({ revision: sessionRevision, userId, payload: {} });
        }
      } catch {
        if (!controller.signal.aborted) {
          setResult({ revision: sessionRevision, userId, payload: {} });
        }
      }
    })();
    return () => controller.abort();
  }, [revision, session]);

  const payload =
    result &&
    result.revision === revision &&
    result.userId === session?.user.id
      ? result.payload
      : null;
  if (loading || !session || !payload) return null;
  const items = payload.items ?? [];
  const summary = payload.summary;
  return (
    <section id="bids">
      <div className="mb-5 flex flex-col items-start gap-3 border-b border-ink pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow text-muted">실시간 경매 / 나의 입찰</p>
          <h2 className="mt-2 text-xl font-black tracking-[-0.05em]">
            입찰 현황
          </h2>
        </div>
        <Link className="text-xs font-bold underline" href="/feed">
          실시간 경매 보기
        </Link>
      </div>
      <div className="mb-4 grid grid-cols-3 gap-px border border-line bg-line">
        <div className="bg-paper p-3 sm:p-4">
          <p className="text-[10px] text-muted">최고 입찰</p>
          <p className="mt-2 font-mono text-xl font-bold">
            {summary?.leading ?? 0}
          </p>
        </div>
        <div className="bg-paper p-3 sm:p-4">
          <p className="text-[10px] text-muted">낙찰·결제</p>
          <p className="mt-2 font-mono text-xl font-bold">
            {summary?.final ?? 0}
          </p>
        </div>
        <div className="bg-paper p-3 sm:p-4">
          <p className="text-[10px] text-muted">확인 필요</p>
          <p className="mt-2 font-mono text-xl font-bold">
            {summary?.outbid ?? 0}
          </p>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="border border-dashed border-line px-4 py-14 text-center text-sm text-muted">
          아직 입찰한 상품이 없습니다. 실시간 경매에서 첫 입찰을 시작해
          보세요.
        </div>
      ) : (
        <div className="divide-y divide-line border-y border-line">
          {items.map((item) => (
            <article className="flex gap-3 py-4 sm:gap-4" key={item.id}>
              <Link
                className="size-20 shrink-0 bg-surface"
                href={`/auction/${item.productId}`}
              >
                <CatalogImage
                  alt=""
                  className="h-full w-full object-cover"
                  src={item.imageUrl}
                />
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-4">
                  <Link
                    className="max-w-full truncate text-sm font-bold hover:underline"
                    href={`/auction/${item.productId}`}
                  >
                    {item.title}
                  </Link>
                  <span
                    className={`shrink-0 text-[10px] font-bold ${item.state === "leading" || item.state === "final" ? "text-emerald-700" : "text-amber-700"}`}
                  >
                    {stateLabels[item.state]}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted">
                  내 입찰 {item.amount.toLocaleString("ko-KR")}원 · 현재가{" "}
                  {item.currentPrice.toLocaleString("ko-KR")}원
                </p>
                <p className="mt-1 text-[10px] text-muted">
                  {new Date(item.createdAt).toLocaleString("ko-KR")} · 마감{" "}
                  {new Date(item.closesAt).toLocaleString("ko-KR")}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
