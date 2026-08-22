"use client";

import { Search, X } from "lucide-react";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";

interface PostcodeResult {
  zonecode: string;
  address: string;
  roadAddress: string;
  jibunAddress: string;
  userSelectedType: "R" | "J";
}

interface PostcodeConstructor {
  new(options: { oncomplete: (data: PostcodeResult) => void; width?: string; height?: string }): { embed: (element: HTMLElement) => void };
}

declare global {
  interface Window {
    kakao?: { Postcode?: PostcodeConstructor };
    daum?: { Postcode?: PostcodeConstructor };
  }
}

export function PostcodeSearchButton({ disabled = false, onSelect }: { disabled?: boolean; onSelect: (result: { postalCode: string; address: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  const markReady = () => {
    const Postcode = window.kakao?.Postcode ?? window.daum?.Postcode;
    if (!Postcode) return;
    setLoadError(false);
    setReady(true);
  };

  const openSearch = () => {
    setOpen(true);
    setLoadError(false);
    markReady();
  };

  useEffect(() => {
    if (!open || !ready || !hostRef.current) return;
    const Postcode = window.kakao?.Postcode ?? window.daum?.Postcode;
    if (!Postcode) return;
    hostRef.current.replaceChildren();
    new Postcode({
      oncomplete: (data) => {
        onSelect({ postalCode: data.zonecode, address: data.userSelectedType === "R" ? data.roadAddress : data.jibunAddress || data.address });
        setOpen(false);
      },
      width: "100%",
      height: "100%",
    }).embed(hostRef.current);
  }, [onSelect, open, ready]);

  return <>
    <Script id="kakao-postcode-service" onError={() => { setReady(false); setLoadError(true); }} onLoad={markReady} onReady={markReady} src="https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js" strategy="afterInteractive" />
    <button className="inline-flex min-h-11 items-center justify-center gap-2 border border-ink px-3 text-xs font-bold disabled:opacity-40" disabled={disabled} onClick={openSearch} type="button"><Search size={14} />주소 검색</button>
    {open ? <div aria-labelledby="postcode-dialog-title" aria-modal="true" className="fixed inset-0 z-[100] grid place-items-center bg-black/65 p-4" role="dialog">
      <div className="flex max-h-[80vh] min-h-[520px] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-paper shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3"><h2 className="text-sm font-black" id="postcode-dialog-title">배송지 주소 검색</h2><button aria-label="주소 검색 닫기" className="grid size-9 place-items-center" onClick={() => setOpen(false)} type="button"><X size={18} /></button></div>
        {loadError ? <div className="p-5 text-xs" role="alert"><p>주소 검색 서비스를 불러오지 못했습니다.</p><button className="mt-4 min-h-11 border border-ink px-4 font-bold" onClick={() => { setLoadError(false); window.location.reload(); }} type="button">다시 불러오기</button></div> : !ready ? <p className="p-5 text-xs text-muted" role="status">주소 검색 서비스를 불러오는 중입니다.</p> : <div className="min-h-0 flex-1" ref={hostRef} />}
      </div>
    </div> : null}
  </>;
}
