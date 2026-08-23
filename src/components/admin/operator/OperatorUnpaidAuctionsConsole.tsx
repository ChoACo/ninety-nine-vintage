"use client";

import { Banknote, PackagePlus, RefreshCw, TimerReset } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { OperatorSecondChanceButton } from "@/components/admin/operator/OperatorSecondChanceButton";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusNotice } from "@/components/ui/StatusNotice";

interface UnpaidOffer {
  id: string;
  offerKind: "original" | "second_chance";
  status: string;
  statusLabel: string;
  bidderDisplayName: string;
  offeredAmount: number;
  offeredAt: string;
  responseDueAt: string | null;
  paymentDueAt: string | null;
}

interface UnpaidProduct {
  id: string;
  title: string;
  imageUrl: string;
  currentPrice: number;
  startingPrice: number;
  finalBidAmount: number | null;
  closesAt: string;
  storeName: string;
  winnerName: string | null;
  winnerAmount: number | null;
  paymentDueAt: string | null;
  canResolve: boolean;
  canSecondChance: boolean;
  blockedReason: string;
  offers: UnpaidOffer[];
}

function dateLabel(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

function timeUntilLabel(value: string | null, now = Date.now()): string {
  if (!value) return "";
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return "";
  const diff = target - now;
  if (diff <= 0) return "기한 경과";
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return `${minutes}분 남음`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours}시간 남음`;
  return `${Math.ceil(hours / 24)}일 남음`;
}

export function OperatorUnpaidAuctionsConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [products, setProducts] = useState<UnpaidProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<{
    productId: string;
    action: "relist" | "convert_fixed";
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (accessToken: string | null) => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const response = await fetch("/api/admin/operator/auctions/unpaid", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        error?: string;
        products?: UnpaidProduct[];
      };
      if (!response.ok)
        throw new Error(payload.error ?? "미결제 낙찰을 불러오지 못했습니다.");
      setProducts(payload.products ?? []);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "미결제 낙찰을 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const interval = window.setInterval(tick, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        tick();
        void load(token);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, token]);

  useEffect(() => {
    void (async () => {
      const session = (await getSupabaseBrowserClient().auth.getSession()).data
        .session;
      setToken(session?.access_token ?? null);
      await load(session?.access_token ?? null);
    })().catch((error) =>
      setNotice(
        error instanceof Error
          ? error.message
          : "운영자 세션을 확인하지 못했습니다.",
      ),
    );
  }, [load]);

  const counts = useMemo(
    () => ({
      total: products.length,
      resolvable: products.filter((product) => product.canResolve).length,
      pending: products.filter(
        (product) => product.canResolve || product.canSecondChance,
      ).length,
    }),
    [products],
  );

  const resolve = async (
    product: UnpaidProduct,
    action: "relist" | "convert_fixed",
  ) => {
    if (!token || busyAction) return;
    const confirmMessage =
      action === "relist"
        ? `'${product.title}' 경매를 다음 10시 드롭으로 재등록할까요?\n기존 낙찰·차순위 이력은 보존되고 새 상품으로 재편성됩니다.`
        : `'${product.title}'을(를) ${product.currentPrice.toLocaleString("ko-KR")}원 즉시구매 상품으로 전환할까요?`;
    if (!window.confirm(confirmMessage)) return;
    setBusyAction({ productId: product.id, action });
    setNotice("");
    try {
      const response = await fetch(
        `/api/admin/operator/auctions/${encodeURIComponent(product.id)}/resolve`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        result?: {
          action?: string;
          fixed_price?: number | null;
          publish_at?: string | null;
        };
      };
      if (!response.ok)
        throw new Error(payload?.error ?? "처리하지 못했습니다.");
      setNotice(
        action === "relist"
          ? `'${product.title}' 경매가 ${dateLabel(payload.result?.publish_at ?? null)} 시작 드롭으로 재등록되었습니다.`
          : `'${product.title}'이(가) ${Number(payload.result?.fixed_price ?? product.currentPrice).toLocaleString("ko-KR")}원 즉시구매 상품으로 전환되었습니다.`,
      );
      await load(token);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "미결제 낙찰을 처리하지 못했습니다.",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const actionBusy = (productId: string) =>
    busyAction?.productId === productId;

  return (
    <div className="space-y-8">
      <SectionHeading
        action={
          <Button
            className="flex items-center gap-2"
            disabled={loading}
            onClick={() => void load(token)}
            type="button"
          >
            <RefreshCw size={13} /> 새로고침
          </Button>
        }
        description="낙찰자가 정산 시간 내 결제하지 않은 마감 경매를 한 번에 처리합니다. 차순위 낙찰 제안, 다음 드롭 재경매 등록, 즉시구매 상품 전환을 선택할 수 있습니다."
        eyebrow="판매센터 / 미결제 낙찰"
        title="미결제 낙찰 처리"
        variant="page"
      />
      {notice && <StatusNotice>{notice}</StatusNotice>}
      <div className="grid grid-cols-3 gap-px border border-line bg-line">
        <div className="bg-paper p-5">
          <p className="text-xs text-muted">전체 마감 미결제</p>
          <p className="mt-2 font-mono text-3xl font-bold">{counts.total}</p>
        </div>
        <div className="bg-paper p-5">
          <p className="text-xs text-muted">즉시 처리 가능</p>
          <p className="mt-2 font-mono text-3xl font-bold">{counts.resolvable}</p>
        </div>
        <div className="bg-paper p-5">
          <p className="text-xs text-muted">차순위 제안 가능</p>
          <p className="mt-2 font-mono text-3xl font-bold">{counts.pending}</p>
        </div>
      </div>

      <div className="divide-y divide-line border-y border-line">
        {products.map((product) => {
          const busy = actionBusy(product.id);
          const latest = product.offers[product.offers.length - 1];
          return (
            <article
              className="flex flex-wrap items-start gap-3 px-3 py-5 sm:flex-nowrap sm:gap-4 sm:px-4"
              key={product.id}
            >
              <CatalogImage
                alt=""
                className="size-16 shrink-0 object-cover"
                src={product.imageUrl}
              />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="truncate text-sm font-bold">{product.title}</p>
                <p className="text-xs text-muted">
                  {product.storeName} · 마감 {dateLabel(product.closesAt)}
                </p>
                {product.winnerName && (
                  <p className="text-xs">
                    <span className="font-bold">{product.winnerName}</span>
                    <span className="text-muted"> 낙찰가 </span>
                    <span className="font-mono font-bold">
                      {Number(product.winnerAmount).toLocaleString("ko-KR")}원
                    </span>
                  </p>
                )}
                {latest && (
                  <p className="text-[10px] text-muted">
                    현재 상태 · <span className="font-bold">{latest.statusLabel}</span>
                    {product.paymentDueAt && (
                      <>
                        {" "}
                        · 결제 기한 {dateLabel(product.paymentDueAt)}{" "}
                        <span className="font-bold text-amber-700">
                          {timeUntilLabel(product.paymentDueAt, now)}
                        </span>
                      </>
                    )}
                  </p>
                )}
                {product.offers.length > 1 && (
                  <ul className="space-y-1">
                    {product.offers.map((offer) => (
                      <li className="text-[10px] text-muted" key={offer.id}>
                        {offer.offerKind === "second_chance" ? "차순위" : "원낙찰"} ·{" "}
                        {offer.bidderDisplayName} ·{" "}
                        {offer.offeredAmount.toLocaleString("ko-KR")}원 ·{" "}
                        <span className="font-bold">{offer.statusLabel}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                <button
                  className="flex min-h-11 shrink-0 items-center gap-1 border border-ink px-3 py-2 text-[10px] font-bold disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!product.canResolve || !!busyAction || !token}
                  onClick={() => void resolve(product, "relist")}
                  title={product.canResolve ? "" : product.blockedReason}
                  type="button"
                >
                  <TimerReset aria-hidden="true" size={11} />
                  {busy && busyAction?.action === "relist" ? "처리 중" : "주문 취소 및 재공개"}
                </button>
                <button
                  className="flex min-h-11 shrink-0 items-center gap-1 border border-ink px-3 py-2 text-[10px] font-bold disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!product.canResolve || !!busyAction || !token}
                  onClick={() => void resolve(product, "convert_fixed")}
                  title={product.canResolve ? "" : product.blockedReason}
                  type="button"
                >
                  <Banknote aria-hidden="true" size={11} />
                  {busy && busyAction?.action === "convert_fixed"
                    ? "처리 중"
                    : "즉시구매 전환"}
                </button>
                {product.canSecondChance ? (
                  <OperatorSecondChanceButton
                    onNotice={setNotice}
                    productId={product.id}
                    productTitle={product.title}
                  />
                ) : (
                  <span
                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-muted"
                    title={product.blockedReason}
                  >
                    <PackagePlus aria-hidden="true" size={11} />
                    차순위 불가
                  </span>
                )}
              </div>
            </article>
          );
        })}
        {!loading && products.length === 0 && (
          <div className="py-20 text-center text-sm text-muted">
            현재 미결제 낙찰이 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}
