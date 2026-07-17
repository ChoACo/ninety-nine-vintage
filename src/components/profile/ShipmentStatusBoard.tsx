"use client";

/* eslint-disable @next/next/no-img-element -- 발송 상품 이미지는 추후 CDN 응답으로 교체합니다. */
import { useEffect, useRef, useState } from "react";

import type { WonAuction } from "@/src/types/auction";
import { formatKoreanDate, formatKRW } from "@/src/utils/formatters";
import { formatShippingDispatchNotice } from "@/src/utils/shipping";

export interface ShipmentStatusBoardProps {
  requestedItems: readonly WonAuction[];
  shippedItems: readonly WonAuction[];
  onNotify?: (message: string) => void;
}

const HANJIN_TRACKING_URL =
  "https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do";

function getTrackingUrl(trackingNumber: string): string {
  const query = new URLSearchParams({
    mCode: "MN038",
    schLang: "KR",
    wblnum: trackingNumber,
    wblnumText: "",
  });

  return `${HANJIN_TRACKING_URL}?${query.toString()}`;
}

async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // file:// 데모 또는 보안 컨텍스트가 아닌 브라우저에서는 아래 방식으로 재시도합니다.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) throw new Error("copy-failed");
}

function EmptyDeliveryState({ children }: { children: string }) {
  return (
    <div className="rounded-[1.4rem] border-2 border-dashed border-[#d9cbbb] bg-white/70 px-5 py-10 text-center text-[17px] font-bold leading-7 text-[#76685e]">
      {children}
    </div>
  );
}

export function ShipmentStatusBoard({
  requestedItems,
  shippedItems,
  onNotify,
}: ShipmentStatusBoardProps) {
  const [toastMessage, setToastMessage] = useState("");
  const toastTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    },
    [],
  );

  const showCopyToast = (message: string) => {
    setToastMessage(message);
    onNotify?.(message);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToastMessage(""), 2_200);
  };

  const handleCopy = async (trackingNumber: string) => {
    try {
      await copyToClipboard(trackingNumber);
      showCopyToast(`송장번호 ${trackingNumber}가 복사되었습니다.`);
    } catch {
      showCopyToast("송장번호를 복사하지 못했습니다. 번호를 길게 눌러 복사해 주세요.");
    }
  };

  return (
    <section aria-labelledby="shipment-status-title" className="mt-10 space-y-4">
      <div>
        <p className="text-[17px] font-bold tracking-[0.16em] text-[#68859a]">
          DELIVERY STATUS
        </p>
        <h2
          id="shipment-status-title"
          className="mt-1 text-2xl font-black text-[#493b31] sm:text-3xl"
        >
          🚚 나의 택배 발송 현황
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <article className="rounded-[1.75rem] border-2 border-[#b9d4df] bg-[#edf7fa] p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xl font-black text-[#3d5863]">
              관리자 발송 대기열
            </h3>
            <span className="rounded-full bg-white px-3 py-1.5 text-[17px] font-black text-[#4a7280]">
              포장 대기 {requestedItems.length}건
            </span>
          </div>

          {requestedItems.length === 0 ? (
            <EmptyDeliveryState>
              현재 접수되어 포장을 기다리는 상품이 없습니다.
            </EmptyDeliveryState>
          ) : (
            <ul className="space-y-3" aria-label="관리자 발송 대기 상품">
              {requestedItems.map((item) => (
                <li
                  key={item.id}
                  className="flex overflow-hidden rounded-[1.35rem] border border-[#c9dfe7] bg-white"
                >
                  <img
                    src={item.thumbnailUrl}
                    alt=""
                    className="h-36 w-28 shrink-0 object-cover"
                  />
                  <div className="min-w-0 flex-1 p-4 text-[17px] leading-7">
                    <h4 className="line-clamp-2 font-extrabold text-[#3d4e57]">
                      {item.title}
                    </h4>
                    <p className="font-black text-[#bd6354]">
                      {formatKRW(item.winningBid)}
                    </p>
                    {item.shippingScheduledAt ? (
                      <p className="mt-2 font-extrabold text-[#3e6c7c]">
                        {formatShippingDispatchNotice(item.shippingScheduledAt)}
                      </p>
                    ) : null}
                    {item.shippingAddress ? (
                      <p className="mt-1 line-clamp-2 font-semibold text-[#68777d]">
                        {item.shippingAddress.label} · {item.shippingAddress.recipientName}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="rounded-[1.75rem] border-2 border-[#b8d9c9] bg-[#eef8f3] p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xl font-black text-[#3c6655]">
              택배 발송 처리된 정보
            </h3>
            <span className="rounded-full bg-white px-3 py-1.5 text-[17px] font-black text-[#4e7d69]">
              발송 완료 {shippedItems.length}건
            </span>
          </div>

          {shippedItems.length === 0 ? (
            <EmptyDeliveryState>
              아직 한진택배로 발송 처리된 상품이 없습니다.
            </EmptyDeliveryState>
          ) : (
            <ul className="space-y-3" aria-label="택배 발송 완료 상품">
              {shippedItems.map((item) => {
                const trackingNumber = item.trackingNumber ?? "";

                return (
                  <li
                    key={item.id}
                    className="overflow-hidden rounded-[1.35rem] border border-[#c9e0d5] bg-white p-4 text-[17px] leading-7"
                  >
                    <div className="flex gap-4">
                      <img
                        src={item.thumbnailUrl}
                        alt=""
                        className="h-28 w-24 shrink-0 rounded-xl object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <h4 className="line-clamp-2 font-extrabold text-[#3d4e47]">
                          {item.title}
                        </h4>
                        <p className="font-black text-[#bd6354]">
                          {formatKRW(item.winningBid)}
                        </p>
                        {item.shippedAt ? (
                          <p className="mt-1 font-bold text-[#61746b]">
                            {formatKoreanDate(item.shippedAt)} 발송
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-4 rounded-2xl bg-[#edf7f2] p-4">
                      <p className="font-extrabold text-[#46705f]">
                        택배사: {item.courier ?? "한진택배"}
                      </p>
                      <p className="mt-1 break-all font-mono text-xl font-black tracking-wide text-[#334c42]">
                        송장번호: {trackingNumber || "등록 준비 중"}
                      </p>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        disabled={!trackingNumber}
                        onClick={() => void handleCopy(trackingNumber)}
                        className="inline-flex min-h-12 items-center justify-center rounded-2xl border-2 border-[#c7b39d] bg-[#fff8ef] px-4 py-2 text-[17px] font-black text-[#6c5849] transition hover:bg-[#ffefdc] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#eadbc9] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        📋 복사하기
                      </button>
                      {trackingNumber ? (
                        <a
                          href={getTrackingUrl(trackingNumber)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#5f9c84] px-4 py-2 text-center text-[17px] font-black text-white transition hover:bg-[#518d76] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#b9ddce]"
                        >
                          🚚 택배 조회하기
                        </a>
                      ) : (
                        <span className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#cad8d1] px-4 py-2 text-[17px] font-black text-white">
                          🚚 조회 준비 중
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </article>
      </div>

      {toastMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-24 left-1/2 z-[120] w-[min(92vw,34rem)] -translate-x-1/2 rounded-2xl border-2 border-[#87b8a3] bg-[#e7f6ef] px-5 py-4 text-center text-[17px] font-black text-[#356b57] shadow-[0_18px_50px_rgba(54,92,76,0.25)]"
        >
          {toastMessage}
        </div>
      ) : null}
    </section>
  );
}
