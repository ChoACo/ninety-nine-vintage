"use client";

import { Search, X } from "lucide-react";
import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

interface PostcodeResult {
  zonecode: string;
  address: string;
  roadAddress: string;
  jibunAddress: string;
  userSelectedType: "R" | "J";
}

interface PostcodeConstructor {
  new (options: {
    oncomplete: (data: PostcodeResult) => void;
    width?: string;
    height?: string;
  }): { embed: (element: HTMLElement) => void };
}

declare global {
  interface Window {
    kakao?: { Postcode?: PostcodeConstructor };
    daum?: { Postcode?: PostcodeConstructor };
  }
}

function postcodeConstructor() {
  return window.kakao?.Postcode ?? window.daum?.Postcode ?? null;
}

export function PostcodeSearchButton({
  disabled = false,
  onSelect,
}: Readonly<{
  disabled?: boolean;
  onSelect: (result: { postalCode: string; address: string }) => void;
}>) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  const markReady = useCallback(() => {
    if (!postcodeConstructor()) return;
    setLoadError(false);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!open || ready) return;
    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      if (postcodeConstructor()) {
        markReady();
        return window.clearInterval(intervalId);
      }
      if (Date.now() - startedAt >= 8_000) {
        window.clearInterval(intervalId);
        setLoadError(true);
      }
    }, 100);
    return () => window.clearInterval(intervalId);
  }, [markReady, open, ready]);

  useEffect(() => {
    if (!open || !ready || !hostRef.current) return;
    const Postcode = postcodeConstructor();
    if (!Postcode) return;
    const host = hostRef.current;
    host.replaceChildren();
    new Postcode({
      oncomplete: (data) => {
        const address =
          data.userSelectedType === "R"
            ? data.roadAddress || data.address
            : data.jibunAddress || data.address;
        onSelect({ postalCode: data.zonecode, address });
        setOpen(false);
      },
      width: "100%",
      height: "100%",
    }).embed(host);
    return () => host.replaceChildren();
  }, [onSelect, open, ready]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <>
      <Script
        id="kakao-postcode-service"
        onError={() => {
          setReady(false);
          setLoadError(true);
        }}
        onLoad={markReady}
        onReady={markReady}
        src="https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js"
        strategy="afterInteractive"
      />
      <button
        className="inline-flex min-h-11 items-center justify-center gap-2 border border-ink px-3 text-xs font-bold disabled:opacity-40"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          setLoadError(false);
          markReady();
        }}
        type="button"
      >
        <Search size={14} /> 주소 검색
      </button>
      {open ? (
        <div
          aria-labelledby="postcode-dialog-title"
          aria-modal="true"
          className="fixed inset-0 z-[100] grid place-items-center bg-black/65 p-4"
          role="dialog"
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-paper shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-sm font-black" id="postcode-dialog-title">
                배송지 주소 검색
              </h2>
              <button
                aria-label="주소 검색 닫기"
                className="grid size-9 place-items-center"
                onClick={() => setOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
            </div>
            {loadError ? (
              <div
                className="flex h-[450px] flex-col items-center justify-center p-5 text-center text-xs"
                role="alert"
              >
                <p>주소 검색 서비스를 불러오지 못했습니다.</p>
                <button
                  className="mt-4 min-h-11 border border-ink px-4 font-bold"
                  onClick={() => {
                    setLoadError(false);
                    setReady(false);
                    markReady();
                  }}
                  type="button"
                >
                  다시 불러오기
                </button>
              </div>
            ) : !ready ? (
              <div className="grid h-[450px] place-items-center" role="status">
                <p className="text-xs text-muted">
                  주소 검색 서비스를 불러오는 중입니다.
                </p>
              </div>
            ) : (
              <div className="h-[450px] w-full bg-white" ref={hostRef} />
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
