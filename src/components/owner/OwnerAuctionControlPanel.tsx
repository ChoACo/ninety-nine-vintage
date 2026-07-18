"use client";

import { useMemo, useState } from "react";

import { Button } from "@/src/components/common";
import { OwnerDangerConfirmModal } from "@/src/components/owner/OwnerDangerConfirmModal";
import { useSupabaseProducts } from "@/src/hooks/useSupabaseProducts";
import {
  ownerCloseAuctionNow,
  ownerOverrideAuctionPrice,
} from "@/src/lib/supabase/auctionLifecycle";
import { formatKRW } from "@/src/utils/formatters";

function parseOptionalPrice(value: string): number | null {
  const normalized = value.replaceAll(",", "").trim();
  if (!normalized) return null;
  const price = Number(normalized);
  return Number.isSafeInteger(price) ? price : Number.NaN;
}

export function OwnerAuctionControlPanel() {
  const { posts, isLoading, error, refreshProducts } = useSupabaseProducts();
  const [selectedId, setSelectedId] = useState("");
  const [startingPrice, setStartingPrice] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [reason, setReason] = useState("서비스 전체 흐름 검증");
  const [isMutating, setIsMutating] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<"override" | "close" | null>(null);

  const selected = useMemo(
    () => posts.find((post) => post.id === selectedId) ?? null,
    [posts, selectedId],
  );

  const handleOverride = () => {
    if (!selected) return;
    const nextStartingPrice = parseOptionalPrice(startingPrice);
    const nextCurrentPrice = parseOptionalPrice(currentPrice);
    if (
      Number.isNaN(nextStartingPrice) ||
      Number.isNaN(nextCurrentPrice) ||
      (nextStartingPrice === null && nextCurrentPrice === null)
    ) {
      setMessage("시작가 또는 현재가를 원 단위 정수로 입력해 주세요.");
      return;
    }

    setConfirmation("override");
  };

  const confirmOverride = async () => {
    if (!selected) return;
    const nextStartingPrice = parseOptionalPrice(startingPrice);
    const nextCurrentPrice = parseOptionalPrice(currentPrice);

    setIsMutating(true);
    setMessage("");
    try {
      await ownerOverrideAuctionPrice({
        productId: selected.id,
        startingPrice: nextStartingPrice,
        currentPrice: nextCurrentPrice,
        reason,
      });
      await refreshProducts();
      setStartingPrice("");
      setCurrentPrice("");
      setConfirmation(null);
      setMessage("테스트 가격을 반영하고 감사 기록을 저장했습니다.");
    } catch (mutationError) {
      setMessage(
        mutationError instanceof Error
          ? mutationError.message
          : "가격을 조정하지 못했습니다.",
      );
    } finally {
      setIsMutating(false);
    }
  };

  const handleClose = () => {
    if (!selected || isMutating) return;
    setConfirmation("close");
  };

  const confirmClose = async () => {
    if (!selected || isMutating) return;
    setIsMutating(true);
    setMessage("");
    try {
      const result = await ownerCloseAuctionNow(selected.id, reason);
      await refreshProducts();
      setSelectedId("");
      setConfirmation(null);
      setMessage(
        result.winnerDisplayName
          ? `${result.winnerDisplayName} 회원에게 ${formatKRW(result.winningAmount ?? 0)}으로 낙찰 처리했습니다.`
          : "입찰자가 없어 낙찰자 없이 마감했습니다.",
      );
    } catch (mutationError) {
      setMessage(
        mutationError instanceof Error
          ? mutationError.message
          : "경매를 마감하지 못했습니다.",
      );
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <section className="rounded-xl border border-red-500/20 bg-[var(--surface)] p-4 sm:p-5" aria-labelledby="auction-test-tools-title">
      <p className="font-mono text-[10px] font-black tracking-[0.18em] text-[var(--accent-text)]">
        AUCTION TEST CONTROLS
      </p>
      <h2 id="auction-test-tools-title" className="mt-1 text-xl font-black tracking-tight text-[var(--text-strong)] sm:text-2xl">
        경매 테스트 제어
      </h2>
      <p className="mt-2 break-keep font-bold leading-7 text-[var(--text-muted)]">
        가격 조정과 즉시 마감은 실제 상품에 반영되며 실행자·사유·변경 전후 값이 삭제할 수 없는 감사 기록으로 남습니다.
      </p>

      {isLoading ? (
        <p className="mt-4 font-bold text-[var(--text-muted)]">진행 상품을 불러오는 중…</p>
      ) : error ? (
        <div className="mt-4 rounded-2xl bg-[var(--danger-surface)] p-4">
          <p className="font-bold text-[var(--danger-text)]">{error}</p>
          <Button className="mt-3" size="sm" onClick={() => void refreshProducts()}>
            다시 불러오기
          </Button>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <label className="text-sm font-black text-[var(--text-strong)]">
            테스트할 진행 상품
            <select
              value={selectedId}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setMessage("");
              }}
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 font-bold"
            >
              <option value="">상품을 선택하세요</option>
              {posts.map((post) => (
                <option key={post.id} value={post.id}>
                  {post.title} · 현재 {formatKRW(post.currentPrice)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-black text-[var(--text-strong)]">
            감사 기록 사유
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={2}
              maxLength={500}
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 font-bold"
            />
          </label>
        </div>
      )}

      {selected ? (
        <div className="mt-4 rounded-2xl bg-[var(--surface-muted)] p-4">
          <p className="font-black text-[var(--text-strong)]">{selected.title}</p>
          <p className="mt-1 text-sm font-bold text-[var(--text-muted)]">
            시작가 {formatKRW(selected.startingPrice)} · 현재가 {formatKRW(selected.currentPrice)} · 입찰 {selected.bidHistory.length}건
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-black text-[var(--text-strong)]">
              새 시작가
              <input
                inputMode="numeric"
                value={startingPrice}
                onChange={(event) => setStartingPrice(event.target.value)}
                placeholder={String(selected.startingPrice)}
                className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 font-bold"
              />
            </label>
            <label className="text-sm font-black text-[var(--text-strong)]">
              새 현재가
              <input
                inputMode="numeric"
                value={currentPrice}
                onChange={(event) => setCurrentPrice(event.target.value)}
                placeholder={String(selected.currentPrice)}
                className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 font-bold"
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              isLoading={isMutating}
              disabled={reason.trim().length < 2}
              onClick={handleOverride}
            >
              금액 조정
            </Button>
            <Button
              variant="danger"
              isLoading={isMutating}
              disabled={reason.trim().length < 2}
              onClick={handleClose}
            >
              즉시 입찰 종료
            </Button>
          </div>
        </div>
      ) : null}

      {message ? (
        <p role="status" className="mt-4 rounded-xl bg-[var(--info-surface)] px-4 py-3 font-bold text-[var(--info-text)]">
          {message}
        </p>
      ) : null}

      <OwnerDangerConfirmModal
        open={Boolean(confirmation && selected)}
        tone="danger"
        eyebrow="AUCTION LEDGER OVERRIDE"
        title={confirmation === "close" ? "경매를 지금 마감할까요?" : "실시간 경매 금액을 조정할까요?"}
        description={confirmation === "close" ? "현재 최고 입찰자가 즉시 낙찰자로 확정되고 상품은 판매 완료 흐름으로 이동합니다." : "시작가 또는 현재가가 실제 상품 피드에 즉시 반영됩니다. 변경 전후 값과 사유는 삭제할 수 없는 감사 기록에 남습니다."}
        confirmLabel={confirmation === "close" ? "즉시 마감 확정" : "금액 조정 확정"}
        isLoading={isMutating}
        details={selected ? [
          { label: "상품", value: selected.title },
          { label: "현재가", value: formatKRW(selected.currentPrice) },
          { label: "변경 현재가", value: confirmation === "override" && currentPrice.trim() ? formatKRW(Number(currentPrice.replaceAll(",", ""))) : "변경 없음" },
          { label: "감사 사유", value: reason.trim() },
        ] : []}
        onCancel={() => setConfirmation(null)}
        onConfirm={confirmation === "close" ? confirmClose : confirmOverride}
      />
    </section>
  );
}
