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

export function BidHistory({ basePath = "", surface = "mobile" }: { basePath?: "" | "/m"; surface?: "desktop" | "mobile" }) {
  const { loading, revision, session } = useSupabaseSession();
  const [result, setResult] = useState<{
    revision: number;
    userId: string;
    payload: BidPayload;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<"active" | "won" | "closed">("active");

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
  const tabItems = items.filter((item) => activeTab === "won" ? item.state === "final" : activeTab === "closed" ? item.state === "closed" : item.state === "leading" || item.state === "outbid");
  const tabs = [
    { id: "active" as const, label: "입찰 중", count: items.filter((item) => item.state === "leading" || item.state === "outbid").length },
    { id: "won" as const, label: "낙찰 완료 (결제 대기)", count: items.filter((item) => item.state === "final").length },
    { id: "closed" as const, label: "종료/유찰", count: items.filter((item) => item.state === "closed").length },
  ];
  return (
    <section id="bids">
      <div className={`mb-5 flex items-start gap-3 border-b border-ink pb-4 ${surface === "desktop" ? "flex-row items-end justify-between" : "flex-col"}`}>
        <div>
          <p className="eyebrow text-muted">실시간 경매 / 나의 입찰</p>
          <h2 className="mt-2 text-xl font-black tracking-[-0.05em]">
            입찰 현황
          </h2>
        </div>
        <Link className="text-xs font-bold underline" href={`${basePath}/feed`}>
          실시간 경매 보기
        </Link>
      </div>
      <div className="mb-5 grid grid-cols-3 border border-line" role="tablist" aria-label="경매 내역 구분">
        {tabs.map((tab) => <button aria-selected={activeTab === tab.id} className={`min-h-12 border-r border-line px-2 text-[10px] font-bold last:border-r-0 sm:text-xs ${activeTab === tab.id ? "bg-ink text-paper" : "bg-paper text-muted"}`} key={tab.id} onClick={() => setActiveTab(tab.id)} role="tab" type="button">{tab.label} <span className="font-mono">{tab.count}</span></button>)}
      </div>
      <div className="mb-4 grid grid-cols-3 gap-px border border-line bg-line">
        <div className={`bg-paper ${surface === "desktop" ? "p-4" : "p-3"}`}>
          <p className="text-[10px] text-muted">최고 입찰</p>
          <p className="mt-2 font-mono text-xl font-bold">
            {summary?.leading ?? 0}
          </p>
        </div>
        <div className={`bg-paper ${surface === "desktop" ? "p-4" : "p-3"}`}>
          <p className="text-[10px] text-muted">낙찰·결제</p>
          <p className="mt-2 font-mono text-xl font-bold">
            {summary?.final ?? 0}
          </p>
        </div>
        <div className={`bg-paper ${surface === "desktop" ? "p-4" : "p-3"}`}>
          <p className="text-[10px] text-muted">확인 필요</p>
          <p className="mt-2 font-mono text-xl font-bold">
            {summary?.outbid ?? 0}
          </p>
        </div>
      </div>
      {tabItems.length === 0 ? (
        <div className="border border-dashed border-line px-4 py-14 text-center text-sm text-muted">
          이 구분에 해당하는 경매 상품이 없습니다.
        </div>
      ) : (
        <div className="divide-y divide-line border-y border-line">
          {tabItems.map((item) => (
            <article className={`flex py-4 ${surface === "desktop" ? "gap-4" : "gap-3"}`} key={item.id}>
              <Link
                className="size-20 shrink-0 bg-surface"
                href={`${basePath}/auction/${item.productId}`}
              >
                <CatalogImage
                  alt=""
                  className="h-full w-full object-cover"
                  sizes="80px"
                  src={item.imageUrl}
                />
              </Link>
              <div className="min-w-0 flex-1">
                <div className={`flex items-start gap-2 ${surface === "desktop" ? "flex-row justify-between gap-4" : "flex-col"}`}>
                  <Link
                    className="max-w-full truncate text-sm font-bold hover:underline"
                    href={`${basePath}/auction/${item.productId}`}
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
                {item.state === "final" && <Link className="mt-3 inline-flex min-h-10 items-center bg-ink px-4 text-xs font-bold text-paper" href={`${basePath}/account/payments`}>결제하기</Link>}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
