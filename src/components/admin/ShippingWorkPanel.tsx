"use client";

import { useCallback, useEffect, useState } from "react";

import Button from "@/src/components/common/Button";
import {
  getPendingShippingWork,
  markShippingRequestShipped,
  type PendingShippingWork,
} from "@/src/lib/supabase/operations";

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatAddressSnapshot(snapshot: unknown): string {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return "배송지 정보를 확인할 수 없습니다.";
  }
  const value = snapshot as Record<string, unknown>;
  const parts = [
    value.recipient_name,
    value.phone,
    value.address,
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  return parts.join(" · ") || "배송지 정보를 확인할 수 없습니다.";
}

export function ShippingWorkPanel() {
  const [items, setItems] = useState<PendingShippingWork[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [courierById, setCourierById] = useState<Record<string, string>>({});
  const [trackingById, setTrackingById] = useState<Record<string, string>>({});
  const [processingId, setProcessingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      setItems(await getPendingShippingWork());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "배송 대기 목록을 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const complete = async (item: PendingShippingWork) => {
    const courier = courierById[item.requestId]?.trim() ?? "";
    const trackingNumber = trackingById[item.requestId]?.trim() ?? "";
    if (!courier || !trackingNumber) {
      setError("택배사와 운송장 번호를 모두 입력해 주세요.");
      return;
    }
    setProcessingId(item.requestId);
    setError("");
    try {
      await markShippingRequestShipped({
        requestId: item.requestId,
        courier,
        trackingNumber,
      });
      setItems((current) => current.filter((entry) => entry.requestId !== item.requestId));
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : "배송 처리를 완료하지 못했습니다.");
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-bold text-[#77685d]">
          회원이 접수한 배송 대기 상품만 표시됩니다.
        </p>
        <Button size="sm" variant="ghost" onClick={() => void load()} isLoading={isLoading}>
          새로고침
        </Button>
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-2xl border border-[#efc8bb] bg-[#fff0ea] px-4 py-3 text-sm font-bold text-[#a84c3f]">
          {error}
        </p>
      ) : null}

      {isLoading && items.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-white px-4 py-8 text-center text-sm font-bold text-[#77685d]">
          배송 대기 목록을 불러오는 중입니다...
        </p>
      ) : items.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-[#ddcfc2] bg-white/70 px-4 py-8 text-center text-sm font-bold text-[#77685d]">
          현재 배송 대기 상품이 없습니다.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <li key={item.requestId} className="rounded-[1.4rem] border border-[#dfd3c7] bg-white p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-black text-[#493b31]">상품 {item.itemCount}건 배송 접수</p>
                  <p className="mt-1 text-xs font-bold text-[#8b7a6d]">{formatDateTime(item.requestedAt)}</p>
                </div>
                <span className="rounded-full bg-[#fff7df] px-3 py-1 text-xs font-black text-[#82673a]">배송 대기</span>
              </div>
              <p className="mt-3 break-words rounded-xl bg-[#faf5ef] px-3 py-2 text-sm font-bold leading-6 text-[#66564c]">
                {formatAddressSnapshot(item.addressSnapshot)}
              </p>
              <p className="mt-2 break-all text-xs font-semibold text-[#9a8a7e]">
                상품 ID: {item.productIds.join(", ")}
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)_auto]">
                <input
                  aria-label="택배사"
                  value={courierById[item.requestId] ?? ""}
                  onChange={(event) => setCourierById((current) => ({ ...current, [item.requestId]: event.target.value }))}
                  placeholder="택배사"
                  className="rounded-xl border border-[#decdbf] bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-[#ec7866]"
                />
                <input
                  aria-label="운송장 번호"
                  value={trackingById[item.requestId] ?? ""}
                  onChange={(event) => setTrackingById((current) => ({ ...current, [item.requestId]: event.target.value }))}
                  placeholder="운송장 번호"
                  className="rounded-xl border border-[#decdbf] bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-[#ec7866]"
                />
                <Button
                  size="sm"
                  isLoading={processingId === item.requestId}
                  disabled={processingId !== null}
                  onClick={() => void complete(item)}
                >
                  발송 완료
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
