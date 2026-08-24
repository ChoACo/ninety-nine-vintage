"use client";

import { Copy, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PremiumDialog } from "@/components/ui/PremiumDialog";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToastStore } from "@/store/useToastStore";

export interface CombinedAuctionWin {
  productId: string;
  title: string;
  amount: number;
  dueAt: string | null;
}

export interface AuctionPaymentCenterGroup {
  businessId: string;
  businessName: string;
  itemCount: number;
  itemSubtotal: number;
  earliestDueAt: string | null;
  items: Array<{
    productId: string;
    title: string;
    amount: number;
    dueAt: string | null;
  }>;
  hasStoredItems: boolean;
  shippingFeeAmount: number;
  shippingFeeCharged: number;
}

interface FeeBreakdownEntry {
  businessId: string;
  amount: number;
}

interface CombinedTransfer {
  paymentId: string;
  depositorName: string;
  expectedAmount: number;
  itemSubtotal: number;
  shippingFee: number;
  includeShippingFee: boolean;
  itemCount: number;
  bankName: string;
  accountNumber: string;
  requestedAt: string;
  dueAt: string | null;
  items: Array<{
    orderId: string;
    productId: string;
    title: string;
    amount: number;
    dueAt: string | null;
  }>;
  shippingFeeBreakdown?: FeeBreakdownEntry[];
}

interface CombinedAuctionPaymentProps {
  deadlineEnforcementExempt: boolean;
  rememberedDepositorName: string | null;
  serverTime: string | null;
  wins: CombinedAuctionWin[];
  groups: AuctionPaymentCenterGroup[];
}

function formatAt(value: string | null) {
  if (!value) return "마감 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function isCombinedTransfer(value: unknown): value is CombinedTransfer {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.paymentId === "string" &&
    typeof row.depositorName === "string" &&
    Number.isSafeInteger(Number(row.expectedAmount)) &&
    Number.isSafeInteger(Number(row.itemSubtotal)) &&
    Number.isSafeInteger(Number(row.shippingFee)) &&
    typeof row.includeShippingFee === "boolean" &&
    Number.isSafeInteger(Number(row.itemCount)) &&
    typeof row.bankName === "string" &&
    typeof row.accountNumber === "string" &&
    typeof row.requestedAt === "string" &&
    (row.dueAt === null || typeof row.dueAt === "string") &&
    Array.isArray(row.items);
}

export function CombinedAuctionPayment({
  deadlineEnforcementExempt,
  rememberedDepositorName,
  serverTime,
  wins,
  groups,
}: CombinedAuctionPaymentProps) {
  const pushToast = useToastStore((state) => state.pushToast);
  const [dialog, setDialog] = useState<"payment" | "info" | null>(null);
  const [busy, setBusy] = useState(false);
  const [depositorName, setDepositorName] = useState(
    rememberedDepositorName ?? "",
  );
  const [includeShippingFee, setIncludeShippingFee] = useState(true);
  const [excludedBusinessIds, setExcludedBusinessIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [transfer, setTransfer] = useState<CombinedTransfer | null>(null);

  const selectedGroups = useMemo(
    () => groups.filter((group) => !excludedBusinessIds.includes(group.businessId)),
    [excludedBusinessIds, groups],
  );
  const selectedItemCount = useMemo(
    () => selectedGroups.reduce((sum, group) => sum + group.itemCount, 0),
    [selectedGroups],
  );
  const selectedItemTotal = useMemo(
    () => selectedGroups.reduce((sum, group) => sum + group.itemSubtotal, 0),
    [selectedGroups],
  );
  const selectedShippingTotal = useMemo(
    () => selectedGroups.reduce(
      (sum, group) =>
        sum + (includeShippingFee ? group.shippingFeeCharged : 0),
      0,
    ),
    [includeShippingFee, selectedGroups],
  );
  const selectedExpectedTotal = selectedItemTotal + selectedShippingTotal;
  const selectedProductIds = useMemo(
    () => selectedGroups.flatMap((group) => group.items.map((item) => item.productId)),
    [selectedGroups],
  );
  const groupsByBusinessId = useMemo(
    () => new Map(groups.map((group) => [group.businessId, group])),
    [groups],
  );

  const total = useMemo(
    () => wins.reduce((sum, win) => sum + win.amount, 0),
    [wins],
  );
  const earliestDeadline = useMemo(
    () => wins
      .flatMap((win) => win.dueAt ? [win.dueAt] : [])
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null,
    [wins],
  );
  const serverNow = serverTime ? Date.parse(serverTime) : Number.NaN;
  const expired = Boolean(
    earliestDeadline &&
    Number.isFinite(serverNow) &&
    Date.parse(earliestDeadline) <= serverNow,
  );
  const paymentBlocked = expired && !deadlineEnforcementExempt;

  useEffect(() => {
    if (!dialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setDialog(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, dialog]);

  const toggleGroup = (businessId: string, checked: boolean) => {
    setExcludedBusinessIds((current) => checked
      ? current.filter((id) => id !== businessId)
      : [...current, businessId]);
  };

  const begin = async () => {
    const canonicalName = depositorName.trim();
    if (!canonicalName) {
      setMessage("입금자명을 입력해 주세요.");
      return;
    }
    if (selectedProductIds.length === 0) {
      setMessage("결제할 센터를 하나 이상 선택해 주세요.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const session = (await getSupabaseBrowserClient().auth.getSession()).data
        .session;
      if (!session?.access_token) throw new Error("로그인 후 결제할 수 있습니다.");
      const response = await fetch("/api/payments/manual-transfer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: "begin",
          depositorName: canonicalName,
          includeShippingFee,
          productIds: selectedProductIds,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        transfer?: unknown;
        error?: string;
        message?: string;
      } | null;
      if (!response.ok || !isCombinedTransfer(payload?.transfer)) {
        throw new Error(
          payload?.message ?? payload?.error ?? "결제 정보를 만들지 못했습니다.",
        );
      }
      setTransfer(payload.transfer);
      setDepositorName(payload.transfer.depositorName);
      setDialog(null);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "결제 정보를 만들지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mt-5 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold">
            {wins.length}개 낙찰품 · 총 {total.toLocaleString("ko-KR")}원
          </p>
          <p className={`mt-1 text-[11px] ${paymentBlocked ? "font-bold text-red-700" : "text-muted"}`}>
            가장 빠른 결제 마감 {formatAt(earliestDeadline)}
          </p>
        </div>
        <button
          className="h-11 bg-ink px-6 text-xs font-bold text-paper disabled:opacity-40"
          disabled={paymentBlocked}
          onClick={() => {
            setMessage("");
            setDepositorName((current) =>
              current || rememberedDepositorName || ""
            );
            setDialog(transfer ? "info" : "payment");
          }}
          type="button"
        >
          {paymentBlocked
            ? "결제 마감"
            : transfer
              ? "입금 정보 보기"
              : "선택 상품 결제하기"}
        </button>
      </div>

      {dialog === "payment" && (
        <PremiumDialog
          closeDisabled={busy}
          labelledBy="combined-auction-payment-title"
          onClose={() => setDialog(null)}
          open
          panelClassName="max-w-lg p-5 sm:p-7"
          zIndexClassName="z-[100]"
        >
            <div className="flex items-start justify-between gap-4 border-b border-ink pb-4">
              <div>
                <p className="eyebrow text-muted">낙찰품 선택 결제</p>
                <h3
                  className="mt-2 text-xl font-black"
                  id="combined-auction-payment-title"
                >
                  센터별로 골라서 결제
                </h3>
                <p className="mt-2 text-[11px] leading-5 text-muted">
                  경매 낙찰품 전용 결제입니다. 즉시구매 상품과는 별도로
                  처리되며, 선택한 센터의 상품만 입금 대기에 추가됩니다.
                </p>
              </div>
              <button
                aria-label="결제 창 닫기"
                className="grid size-11 shrink-0 place-items-center"
                disabled={busy}
                onClick={() => setDialog(null)}
                type="button"
              >
                <X size={18} />
              </button>
            </div>

            <label className="mt-4 flex cursor-pointer items-center gap-2 bg-surface px-3 py-3 text-xs font-bold">
              <input
                checked={selectedGroups.length === groups.length}
                onChange={(event) =>
                  setExcludedBusinessIds(
                    event.target.checked
                      ? []
                      : groups.map((group) => group.businessId),
                  )
                }
                type="checkbox"
              />
              전체 선택 · {groups.length}개 센터 {wins.length}개 상품
            </label>

            <div className="divide-y divide-line border-y border-line">
              {groups.map((group) => {
                const isSelected = !excludedBusinessIds.includes(group.businessId);
                return (
                  <div className="py-3" key={group.businessId}>
                    <label className="flex cursor-pointer items-start justify-between gap-3">
                      <span className="flex min-w-0 items-start gap-2">
                        <input
                          checked={isSelected}
                          className="mt-0.5"
                          onChange={(event) =>
                            toggleGroup(group.businessId, event.target.checked)
                          }
                          type="checkbox"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-black">
                            {group.businessName}
                          </span>
                          <span className="mt-1 block text-[11px] text-muted">
                            상품 {group.itemCount}개 · {group.itemSubtotal.toLocaleString("ko-KR")}원
                            {" · 마감 "}
                            {formatAt(group.earliestDueAt)}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-[11px] font-bold">
                        {group.hasStoredItems ? (
                          <>
                            <span className="block text-emerald-700">
                              보관중 합포장 대상
                            </span>
                            <span className="mt-0.5 block font-mono">
                              택배비 0원
                            </span>
                          </>
                        ) : (
                          <span className="block font-mono">
                            +택배비 {group.shippingFeeCharged.toLocaleString("ko-KR")}원
                          </span>
                        )}
                      </span>
                    </label>
                    {isSelected && (
                      <ul className="ml-6 mt-2 space-y-1 border-l border-line pl-3">
                        {group.items.map((item) => (
                          <li
                            className="flex items-center justify-between gap-3 text-[11px]"
                            key={item.productId}
                          >
                            <span className="min-w-0 truncate">{item.title}</span>
                            <span className="shrink-0 font-mono">
                              {item.amount.toLocaleString("ko-KR")}원
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>

            <label className="mt-5 flex cursor-pointer items-start gap-3 border border-line bg-surface p-4">
              <input
                checked={includeShippingFee}
                className="mt-0.5"
                onChange={(event) => setIncludeShippingFee(event.target.checked)}
                type="checkbox"
              />
              <span>
                <span className="block text-xs font-black">택배비 포함 결제</span>
                <span className="mt-1 block text-[11px] leading-5 text-muted">
                  각 센터에 설정된 택배비를 합산해 함께 결제합니다. 해당 센터에
                  보관 중인 상품이 있으면 이번 택배비는 청구되지 않습니다.
                </span>
              </span>
            </label>
            <div className="mt-4 space-y-2 border-y border-line py-4 text-xs">
              <p className="flex justify-between gap-4">
                <span>낙찰품 합계 ({selectedItemCount}개)</span>
                <span>{selectedItemTotal.toLocaleString("ko-KR")}원</span>
              </p>
              {includeShippingFee && (
                <p className="flex justify-between gap-4 font-bold">
                  <span>+택배비</span>
                  <span>{selectedShippingTotal.toLocaleString("ko-KR")}원</span>
                </p>
              )}
              <p className="flex justify-between gap-4 border-t border-line pt-2 text-sm font-black">
                <span>총 결제 금액</span>
                <span>{selectedExpectedTotal.toLocaleString("ko-KR")}원</span>
              </p>
            </div>
            <label className="mt-6 block text-xs font-bold" htmlFor="combined-auction-depositor">
              입금자명 <span className="text-red-700">필수</span>
            </label>
            <input
              autoFocus
              className="mt-2 h-11 w-full border border-line px-3 text-sm"
              id="combined-auction-depositor"
              maxLength={80}
              onChange={(event) => setDepositorName(event.target.value)}
              placeholder="실제 입금할 이름"
              value={depositorName}
            />
            <p className="mt-2 text-[11px] text-muted">
              저장된 이름이 있어도 확인을 위해 매번 이 창이 열립니다. 이름은 언제든 수정할 수 있습니다.
            </p>
            <button
              className="mt-5 h-12 w-full bg-ink text-sm font-bold text-paper disabled:opacity-40"
              disabled={busy || !depositorName.trim() || selectedProductIds.length === 0}
              onClick={() => void begin()}
              type="button"
            >
              {busy ? "결제 정보 만드는 중..." : `${selectedItemCount}개 결제하기`}
            </button>
            {message && (
              <p aria-live="polite" className="mt-4 text-xs font-bold text-red-700">
                {message}
              </p>
            )}
        </PremiumDialog>
      )}

      {dialog === "info" && transfer && (
        <PremiumDialog
          labelledBy="combined-auction-transfer-title"
          onClose={() => setDialog(null)}
          open
          panelClassName="max-w-lg p-5 sm:p-7"
          zIndexClassName="z-[100]"
        >
            <div className="flex items-start justify-between gap-4 border-b border-ink pb-4">
              <div>
                <p className="eyebrow text-muted">낙찰품 선택 결제</p>
                <h3 className="mt-2 text-xl font-black" id="combined-auction-transfer-title">
                  입금 정보
                </h3>
              </div>
              <button aria-label="입금 정보 창 닫기" className="grid size-11 shrink-0 place-items-center" onClick={() => setDialog(null)} type="button">
                <X size={18} />
              </button>
            </div>
            <div className="mt-6 border border-ink bg-surface p-4 text-sm leading-7">
              <p className="font-black">입금 정보가 준비되었습니다.</p>
              <button
                aria-label={`${transfer.bankName} 계좌번호 복사`}
                className="mt-2 flex min-h-11 w-full items-center justify-between rounded-xl border border-line bg-paper px-3 text-left font-mono font-bold"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(transfer.accountNumber)
                    .then(() => pushToast("success", "계좌번호를 복사했습니다."))
                    .catch(() => pushToast("error", "계좌번호를 복사하지 못했습니다."));
                }}
                type="button"
              >
                <span>{transfer.bankName} {transfer.accountNumber}</span>
                <Copy aria-hidden="true" className="shrink-0" size={16} />
              </button>
              <p>입금자명 {transfer.depositorName}</p>
              <div className="my-3 border-y border-line py-3 text-xs">
                <p className="flex justify-between gap-4">
                  <span>낙찰품 합계 ({transfer.itemCount}개)</span>
                  <span>{transfer.itemSubtotal.toLocaleString("ko-KR")}원</span>
                </p>
                {transfer.includeShippingFee &&
                  (transfer.shippingFeeBreakdown?.length ?? 0) > 0 ? (
                    transfer.shippingFeeBreakdown!.map((entry) => {
                      const group = groupsByBusinessId.get(entry.businessId);
                      return (
                        <p
                          className="mt-1 flex justify-between gap-4"
                          key={entry.businessId}
                        >
                          <span>
                            +택배비 ·{" "}
                            {entry.amount === 0
                              ? `${group?.businessName ?? "센터"} 보관중 합포장`
                              : group?.businessName ?? "센터"}
                          </span>
                          <span>
                            {entry.amount.toLocaleString("ko-KR")}원
                          </span>
                        </p>
                      );
                    })
                  ) : transfer.includeShippingFee ? (
                    <p className="mt-1 flex justify-between gap-4">
                      <span>+택배비</span>
                      <span>{transfer.shippingFee.toLocaleString("ko-KR")}원</span>
                    </p>
                  ) : null}
              </div>
              <p className="flex justify-between gap-4 font-black">
                <span>총 결제 금액</span>
                <span>{transfer.expectedAmount.toLocaleString("ko-KR")}원</span>
              </p>
              <p className="mt-2 text-xs text-muted">결제 마감 {formatAt(transfer.dueAt)}</p>
              <p className="mt-3 text-xs">
                위 총액을 한 번만 입금해 주세요. 운영자가 입금을 확인하면 선택한 낙찰품이 함께 결제 완료됩니다.
              </p>
            </div>
            <button
              className="mt-3 w-full border border-ink px-4 py-3 text-xs font-bold"
              onClick={() => {
                setTransfer(null);
                setMessage("");
                setDialog("payment");
              }}
              type="button"
            >
              입금자명 수정하기
            </button>
        </PremiumDialog>
      )}
    </>
  );
}
