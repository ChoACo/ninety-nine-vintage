"use client";

import { AlertTriangle, Gavel, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { PremiumDialog } from "@/components/ui/PremiumDialog";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface ActiveBidItem {
  amount: number;
  bidIncrement: number;
  closesAt: string;
  createdAt: string;
  currentPrice: number;
  id: string;
  imageUrl: string;
  productId: string;
  productStatus: string;
  state: "leading" | "final" | "outbid" | "closed";
  title: string;
}

interface BidPayload {
  items?: ActiveBidItem[];
}

async function fetchActiveBidItems(
  accessToken: string,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/account/bids", {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
  const payload = await response.json().catch(() => null) as
    | (BidPayload & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? "입찰 상품을 불러오지 못했습니다.");
  }
  return (payload?.items ?? []).filter(
    (item) => item.productStatus === "active",
  );
}

export function ActiveBidProducts({
  basePath = "",
  surface = "desktop",
}: {
  basePath?: "" | "/m";
  surface?: "desktop" | "mobile";
}) {
  const { loading: sessionLoading, session } = useSupabaseSession();
  const [items, setItems] = useState<ActiveBidItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmItem, setConfirmItem] = useState<ActiveBidItem | null>(null);
  const [bidBusy, setBidBusy] = useState(false);
  const accessToken = session?.access_token ?? null;

  const load = useCallback(async () => {
    if (!accessToken) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      setItems(await fetchActiveBidItems(accessToken));
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "입찰 상품을 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    void fetchActiveBidItems(accessToken, controller.signal)
      .then(setItems)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setNotice(
            error instanceof Error
              ? error.message
              : "입찰 상품을 불러오지 못했습니다.",
          );
        }
      });
    return () => controller.abort();
  }, [accessToken]);

  const productIdKey = useMemo(
    () => items.map((item) => item.productId).sort().join(","),
    [items],
  );

  useEffect(() => {
    if (!accessToken || !session?.user.id || productIdKey.length === 0) return;
    const productIds = new Set(productIdKey.split(","));
    const client = getSupabaseBrowserClient();
    const channel = client
      .channel(`active-bids:${session.user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "products" },
        (payload) => {
          const changedId = (
            payload.new as { id?: unknown } | null
          )?.id;
          if (typeof changedId === "string" && productIds.has(changedId)) {
            void fetchActiveBidItems(accessToken).then(setItems).catch(() => undefined);
          }
        },
      )
      .subscribe();
    const fallback = window.setInterval(() => {
      void fetchActiveBidItems(accessToken).then(setItems).catch(() => undefined);
    }, 15_000);
    return () => {
      window.clearInterval(fallback);
      void client.removeChannel(channel);
    };
  }, [accessToken, productIdKey, session?.user.id]);

  const quickBid = async () => {
    if (!session?.access_token || !confirmItem || bidBusy) return;
    const amount = confirmItem.currentPrice + 1_000;
    setBidBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/auction/bids", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amount, productId: confirmItem.productId }),
      });
      const payload = await response.json().catch(() => null) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "간편입찰을 완료하지 못했습니다.");
      }
      setConfirmItem(null);
      setNotice(`${amount.toLocaleString("ko-KR")}원으로 입찰했습니다.`);
      await load();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "간편입찰을 완료하지 못했습니다.",
      );
      await load();
    } finally {
      setBidBusy(false);
    }
  };

  if (sessionLoading) {
    return <p className="py-20 text-center text-sm text-muted">로그인 상태를 확인하는 중입니다.</p>;
  }
  if (!session) {
    const next = `${basePath}/bidding`;
    return (
      <div className="border border-dashed border-line bg-surface px-6 py-20 text-center">
        <Gavel className="mx-auto" size={24} />
        <h1 className="mt-5 text-2xl font-black">입찰 중인 상품</h1>
        <p className="mt-3 text-sm text-muted">로그인하면 현재 참여 중인 경매만 모아서 볼 수 있습니다.</p>
        <Link
          className="mt-6 inline-flex h-11 items-center justify-center bg-ink px-6 text-xs font-bold text-paper"
          href={`${basePath}/account/login?next=${encodeURIComponent(next)}`}
        >
          로그인
        </Link>
      </div>
    );
  }

  const outbidCount = items.filter((item) => item.state === "outbid").length;
  return (
    <div>
      <div className="flex flex-col justify-between gap-5 border-b border-ink pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow text-muted">나의 실시간 경매</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-.07em]">입찰 중인 상품</h1>
          <p className="mt-3 text-sm text-muted">
            참여한 경매 중 현재 진행 중인 상품만 표시합니다.
          </p>
        </div>
        <button
          className="inline-flex h-10 items-center justify-center gap-2 border border-line px-4 text-xs font-bold"
          disabled={loading}
          onClick={() => void load()}
          type="button"
        >
          <RefreshCw className={loading ? "animate-spin" : ""} size={13} /> 새로고침
        </button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-px border border-line bg-line">
        <div className="bg-paper p-4">
          <p className="text-[10px] text-muted">진행 중</p>
          <p className="mt-2 font-mono text-2xl font-black">{items.length}</p>
        </div>
        <div className={outbidCount > 0 ? "bg-rose-50 p-4" : "bg-paper p-4"}>
          <p className="text-[10px] text-muted">상위 입찰 필요</p>
          <p className={outbidCount > 0 ? "mt-2 font-mono text-2xl font-black text-rose-700" : "mt-2 font-mono text-2xl font-black"}>
            {outbidCount}
          </p>
        </div>
      </div>

      {notice && (
        <p aria-live="polite" className="mt-4 border border-line bg-surface px-4 py-3 text-xs">
          {notice}
        </p>
      )}

      {items.length === 0 ? (
        <div className="mt-6 border border-dashed border-line px-5 py-16 text-center">
          <p className="text-sm font-bold">현재 입찰 중인 상품이 없습니다.</p>
          <Link className="mt-4 inline-block text-xs font-bold underline" href={`${basePath}/feed`}>
            실시간 경매 둘러보기
          </Link>
        </div>
      ) : (
        <div className={`mt-6 grid gap-4 ${surface === "desktop" ? "grid-cols-3" : "grid-cols-2"}`}>
          {items.map((item) => {
            const outbid = item.state === "outbid";
            return (
              <article
                className={outbid ? "overflow-hidden border-2 border-rose-500 bg-paper" : "overflow-hidden border border-line bg-paper"}
                key={item.productId}
              >
                <Link href={`${basePath}/auction/${item.productId}`}>
                  <div className="relative">
                    <CatalogImage
                      alt=""
                      className="aspect-square w-full object-cover"
                      sizes={surface === "desktop" ? "360px" : "50vw"}
                      src={item.imageUrl}
                    />
                    <span className={outbid ? "absolute inset-x-2 top-2 bg-rose-600 px-2 py-2 text-center text-[10px] font-black text-white" : "absolute inset-x-2 top-2 bg-emerald-700 px-2 py-2 text-center text-[10px] font-black text-white"}>
                      {outbid ? "다른 회원이 더 높은 가격으로 입찰했습니다" : "현재 최고 입찰자입니다"}
                    </span>
                  </div>
                </Link>
                <div className="p-3">
                  <Link className="line-clamp-2 min-h-10 text-sm font-black hover:underline" href={`${basePath}/auction/${item.productId}`}>
                    {item.title}
                  </Link>
                  <p className="mt-3 text-[10px] text-muted">내 입찰</p>
                  <p className="font-mono text-xs font-bold">{item.amount.toLocaleString("ko-KR")}원</p>
                  <p className="mt-2 text-[10px] text-muted">현재 최고가</p>
                  <p className="font-mono text-base font-black">{item.currentPrice.toLocaleString("ko-KR")}원</p>
                  <p className="mt-2 text-[10px] text-muted">
                    마감 {new Date(item.closesAt).toLocaleString("ko-KR")}
                  </p>
                  {outbid ? (
                    <button
                      className="mt-4 h-11 w-full bg-ink px-3 text-xs font-black text-paper"
                      onClick={() => setConfirmItem(item)}
                      type="button"
                    >
                      +1,000원 간편입찰
                    </button>
                  ) : (
                    <p className="mt-4 flex h-11 items-center justify-center border border-emerald-300 bg-emerald-50 text-xs font-bold text-emerald-800">
                      최고 입찰 유지 중
                    </p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <PremiumDialog
        closeDisabled={bidBusy}
        labelledBy="quick-bid-title"
        onClose={() => setConfirmItem(null)}
        open={Boolean(confirmItem)}
        panelClassName="max-w-md"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line p-5">
          <div>
            <p className="eyebrow text-muted">간편입찰 확인</p>
            <h2 className="mt-2 text-xl font-black" id="quick-bid-title">최고가보다 1,000원 높게 입찰</h2>
          </div>
          <button
            aria-label="간편입찰 창 닫기"
            className="p-2"
            disabled={bidBusy}
            onClick={() => setConfirmItem(null)}
            type="button"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5">
          <p className="text-sm font-black">{confirmItem?.title}</p>
          <div className="mt-4 border border-line bg-surface p-4">
            <p className="text-xs text-muted">입찰 금액</p>
            <p className="mt-2 font-mono text-2xl font-black">
              {((confirmItem?.currentPrice ?? 0) + 1_000).toLocaleString("ko-KR")}원
            </p>
          </div>
          <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-amber-800">
            <AlertTriangle className="mt-0.5 shrink-0" size={14} />
            확인하면 현재 최고 입찰가보다 정확히 1,000원 높은 금액으로 즉시 입찰합니다.
          </p>
          <button
            className="mt-5 h-11 w-full bg-ink text-xs font-black text-paper disabled:opacity-40"
            disabled={bidBusy}
            onClick={() => void quickBid()}
            type="button"
          >
            {bidBusy ? "입찰 처리 중" : "확인하고 간편입찰"}
          </button>
        </div>
      </PremiumDialog>
    </div>
  );
}
