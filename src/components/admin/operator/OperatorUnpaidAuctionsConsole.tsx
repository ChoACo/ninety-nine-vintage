"use client";

import { Archive, BadgeCheck, PackagePlus, RefreshCw, TimerReset, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { OperatorSecondChanceButton } from "@/components/admin/operator/OperatorSecondChanceButton";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { Button } from "@/components/ui/Button";
import { PremiumDialog } from "@/components/ui/PremiumDialog";
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
  ownerForceOfferId: string | null;
  canOwnerForcePayment: boolean;
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

function loadErrorMessage(error: unknown): string {
  if (error instanceof Error && /[가-힣]/.test(error.message)) {
    return error.message;
  }
  return "미결제 낙찰 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

export function OperatorUnpaidAuctionsConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [products, setProducts] = useState<UnpaidProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<{
    productId: string;
    action: "relist" | "archive" | "delete" | "force_payment";
  } | null>(null);
  const [forceTarget, setForceTarget] = useState<UnpaidProduct | null>(null);
  const [forceDepositorName, setForceDepositorName] = useState("");
  const [includeInSettlement, setIncludeInSettlement] = useState(true);
  const [forceReason, setForceReason] = useState("");
  const [forceIdempotencyKey, setForceIdempotencyKey] = useState("");
  const [notice, setNotice] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (accessToken: string | null) => {
    if (!accessToken) return;
    setLoading(true);
    setLoadFailed(false);
    setNotice("");
    try {
      const response = await fetch("/api/admin/operator/auctions/unpaid", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        error?: string;
        message?: string;
        isOwner?: boolean;
        products?: UnpaidProduct[];
      };
      if (!response.ok)
        throw new Error(payload.message ?? "미결제 낙찰을 불러오지 못했습니다.");
      setIsOwner(payload.isOwner === true);
      setProducts(payload.products ?? []);
    } catch (error) {
      setLoadFailed(true);
      setNotice(loadErrorMessage(error));
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
      try {
        const session = (await getSupabaseBrowserClient().auth.getSession()).data
          .session;
        setToken(session?.access_token ?? null);
        if (!session?.access_token) {
          setLoadFailed(true);
          setLoading(false);
          setNotice("로그인 상태를 확인한 뒤 다시 시도해 주세요.");
          return;
        }
        await load(session.access_token);
      } catch (error) {
        setLoadFailed(true);
        setLoading(false);
        setNotice(loadErrorMessage(error));
      }
    })();
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
    action: "relist" | "archive" | "delete",
  ) => {
    if (!token || busyAction) return;
    const confirmMessage =
      action === "relist"
        ? `'${product.title}' 경매를 다음 10시 드롭으로 재등록할까요?\n기존 낙찰·차순위 이력은 보존되고 새 상품으로 재편성됩니다.`
        : action === "archive"
          ? `'${product.title}'을(를) 예약 아카이브숍 상품으로 이동할까요?`
          : `'${product.title}'의 활성 판매를 완전히 종료할까요? 거래 원장은 감사 이력으로 보존됩니다.`;
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
      await load(token);
      setNotice(
        action === "relist"
          ? `'${product.title}' 경매가 ${dateLabel(payload.result?.publish_at ?? null)} 시작 드롭으로 재등록되었습니다.`
          : action === "archive"
            ? `'${product.title}'이(가) ${dateLabel(payload.result?.publish_at ?? null)} 아카이브숍 예약 상품으로 이동했습니다.`
            : `'${product.title}' 상품을 삭제 상태로 전환했습니다.`,
      );
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

  const openForcePayment = (product: UnpaidProduct) => {
    if (!isOwner || !product.canOwnerForcePayment || !product.ownerForceOfferId) return;
    setNotice("");
    setForceTarget(product);
    setForceDepositorName("");
    setIncludeInSettlement(true);
    setForceReason("");
    setForceIdempotencyKey(crypto.randomUUID());
  };

  const forcePayment = async () => {
    if (!token || !forceTarget?.ownerForceOfferId || !forceIdempotencyKey || busyAction) return;
    const depositorName = forceDepositorName.trim();
    const reason = forceReason.trim();
    if (!depositorName || reason.length < 3) return;
    setBusyAction({ productId: forceTarget.id, action: "force_payment" });
    setNotice("");
    try {
      const response = await fetch("/api/admin/operator/auctions/unpaid", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "force_confirm_payment",
          offerId: forceTarget.ownerForceOfferId,
          depositorName,
          includeInSettlement,
          reason,
          idempotencyKey: forceIdempotencyKey,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        error?: string;
        message?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.message ?? payload?.error ?? "강제 결제완료를 처리하지 못했습니다.");
      }
      const title = forceTarget.title;
      setForceTarget(null);
      setForceReason("");
      window.dispatchEvent(new Event("owner-payment-updated"));
      await load(token);
      setNotice(`'${title}' 낙찰 원장을 결제완료 처리하고 구매자 보관상품으로 진행했습니다.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "강제 결제완료를 처리하지 못했습니다.");
    } finally {
      setBusyAction(null);
    }
  };

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
        description="낙찰자가 정산 시간 내 결제하지 않은 마감 경매를 처리합니다. 소유자는 실제 입금을 확인한 건을 즉시 결제완료로 복구할 수 있고, 운영자는 차순위 제안·재공개·아카이브 전환을 선택할 수 있습니다."
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
        {loading && products.length === 0 && (
          <div className="py-20 text-center text-sm text-muted" role="status">
            미결제 낙찰 정보를 불러오는 중입니다.
          </div>
        )}
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
                {isOwner && (
                  <button
                    className="flex min-h-11 shrink-0 items-center gap-1 bg-ink px-3 py-2 text-[10px] font-black text-paper disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={!product.canOwnerForcePayment || !!busyAction || !token}
                    onClick={() => openForcePayment(product)}
                    title={product.canOwnerForcePayment ? "" : "강제 완료할 원 낙찰 원장이 없습니다."}
                    type="button"
                  >
                    <BadgeCheck aria-hidden="true" size={12} />
                    {busy && busyAction?.action === "force_payment"
                      ? "완료 처리 중"
                      : "즉시 결제완료 처리"}
                  </button>
                )}
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
                  onClick={() => void resolve(product, "archive")}
                  title={product.canResolve ? "" : product.blockedReason}
                  type="button"
                >
                  <Archive aria-hidden="true" size={11} />
                  {busy && busyAction?.action === "archive"
                    ? "처리 중"
                    : "아카이브숍 예약"}
                </button>
                <button
                  className="flex min-h-11 shrink-0 items-center gap-1 border border-red-300 px-3 py-2 text-[10px] font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!product.canResolve || !!busyAction || !token}
                  onClick={() => void resolve(product, "delete")}
                  title={product.canResolve ? "" : product.blockedReason}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={11} />
                  {busy && busyAction?.action === "delete" ? "처리 중" : "상품 삭제"}
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
        {!loading && loadFailed && products.length === 0 && (
          <div className="space-y-3 py-20 text-center text-sm text-muted">
            <p>미결제 낙찰 정보를 표시할 수 없습니다.</p>
            <Button onClick={() => void load(token)} type="button">
              다시 시도
            </Button>
          </div>
        )}
        {!loading && !loadFailed && products.length === 0 && (
          <div className="py-20 text-center text-sm text-muted">
            현재 미결제 낙찰이 없습니다.
          </div>
        )}
      </div>
      <PremiumDialog
        ariaLabel="소유자 즉시 결제완료 처리"
        closeDisabled={busyAction !== null}
        onClose={() => {
          if (!busyAction) setForceTarget(null);
        }}
        open={forceTarget !== null}
        panelClassName="max-w-xl"
        zIndexClassName="z-[160]"
      >
        {forceTarget && (
          <div className="p-5 text-ink sm:p-7">
            <p className="eyebrow text-muted">소유자 전용 원장 복구</p>
            <h3 className="mt-2 text-xl font-black">즉시 결제완료 처리</h3>
            <p className="mt-3 text-xs leading-5 text-muted">
              은행 입금을 직접 확인한 경우에만 사용하세요. 만료된 원 낙찰과 보관상품 원장을 복구하고, 미완료 차순위 제안 및 잘못 부여된 미결제 제재를 함께 철회합니다.
            </p>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-xs">
              <div className="border border-line p-3">
                <dt className="text-muted">구매자</dt>
                <dd className="mt-1 font-bold">{forceTarget.winnerName ?? "-"}</dd>
              </div>
              <div className="border border-line p-3">
                <dt className="text-muted">확인 금액</dt>
                <dd className="mt-1 font-mono font-black">
                  {Number(forceTarget.winnerAmount ?? 0).toLocaleString("ko-KR")}원
                </dd>
              </div>
            </dl>
            <label className="mt-5 block text-xs font-bold" htmlFor="unpaid-force-payment-depositor">
              실제 입금자명
            </label>
            <input
              autoComplete="off"
              className="mt-2 h-11 w-full border border-line bg-paper px-3 text-sm"
              id="unpaid-force-payment-depositor"
              maxLength={80}
              onChange={(event) => setForceDepositorName(event.target.value)}
              placeholder="은행 입금내역의 입금자명"
              value={forceDepositorName}
            />
            <fieldset className="mt-5 border border-line p-4">
              <legend className="px-2 text-xs font-black">판매센터 정산 반영</legend>
              <label className="flex cursor-pointer items-start gap-2 text-xs">
                <input
                  checked={includeInSettlement}
                  name="unpaid-settlement-disposition"
                  onChange={() => setIncludeInSettlement(true)}
                  type="radio"
                />
                <span>
                  <strong>정산 포함</strong>
                  <small className="mt-1 block text-muted">배송 완료 후 판매대금과 수수료를 정상 정산에 반영합니다.</small>
                </span>
              </label>
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs">
                <input
                  checked={!includeInSettlement}
                  name="unpaid-settlement-disposition"
                  onChange={() => setIncludeInSettlement(false)}
                  type="radio"
                />
                <span>
                  <strong>정산 미포함</strong>
                  <small className="mt-1 block text-muted">결제·보관·배송은 진행하지만 판매대금과 수수료는 정산에서 제외합니다.</small>
                </span>
              </label>
            </fieldset>
            <label className="mt-5 block text-xs font-bold" htmlFor="unpaid-force-payment-reason">
              강제 처리 사유 (감사 기록)
            </label>
            <textarea
              className="mt-2 min-h-24 w-full resize-y border border-line bg-paper px-3 py-3 text-sm"
              id="unpaid-force-payment-reason"
              maxLength={500}
              onChange={(event) => setForceReason(event.target.value)}
              placeholder="예: 입금 요청 전달 오류를 확인했고 실제 은행 입금내역과 일치함"
              value={forceReason}
            />
            <div className="mt-6 flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:justify-end">
              <button
                className="h-11 border border-line px-5 text-xs font-bold"
                disabled={busyAction !== null}
                onClick={() => setForceTarget(null)}
                type="button"
              >
                취소
              </button>
              <button
                className="h-11 bg-ink px-5 text-xs font-black text-paper disabled:opacity-40"
                disabled={busyAction !== null || !forceDepositorName.trim() || forceReason.trim().length < 3}
                onClick={() => void forcePayment()}
                type="button"
              >
                {busyAction?.action === "force_payment"
                  ? "처리 중..."
                  : includeInSettlement
                    ? "결제완료 · 정산 포함"
                    : "결제완료 · 정산 미포함"}
              </button>
            </div>
          </div>
        )}
      </PremiumDialog>
    </div>
  );
}
