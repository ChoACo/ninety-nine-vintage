"use client";

import { Check, Database, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { CACHE_CONSENT_EVENT, clearCacheConsent, readCacheConsent, writeCacheConsent, type CacheConsent } from "@/lib/cacheConsent";

const CACHE_NAME = "ninetynine-public-v2";
const CACHE_CONSENT_NAME = "ninetynine-cache-consent-v1";
const subscribeToConsent = (onStoreChange: () => void) => {
  window.addEventListener(CACHE_CONSENT_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(CACHE_CONSENT_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
};

async function registerPublicCache() {
  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    const worker = registration.active || registration.waiting || registration.installing;
    worker?.postMessage({ type: "ENABLE_PUBLIC_CACHE" });
  }
}

async function clearPublicCache() {
  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const worker = registration?.active || registration?.waiting || registration?.installing;
    worker?.postMessage({ type: "CLEAR_PUBLIC_CACHE" });
  }
  await Promise.all([caches.delete(CACHE_NAME), caches.delete(CACHE_CONSENT_NAME)]);
}

export function CacheConsentBanner({ surface = "mobile" }: { surface?: "desktop" | "mobile" }) {
  const pathname = usePathname();
  const [consent, setConsent] = useState<CacheConsent>("unknown");

  useEffect(() => {
    const sync = () => {
      const current = readCacheConsent();
      setConsent(current);
      if (current === "accepted") {
        void registerPublicCache().catch(() => undefined);
      }
    };
    sync();
    window.addEventListener(CACHE_CONSENT_EVENT, sync);
    return () => window.removeEventListener(CACHE_CONSENT_EVENT, sync);
  }, []);

  if (pathname === "/" || consent !== "unknown") return null;
  const detailHasFixedMobileAction = /^\/auction\/[^/]+$/.test(pathname);
  const accept = () => { writeCacheConsent("accepted"); void registerPublicCache().catch(() => undefined); };
  const decline = () => { writeCacheConsent("declined"); void clearPublicCache().catch(() => undefined); };
  const mobileBottom = detailHasFixedMobileAction
    ? "bottom-[calc(9rem+env(safe-area-inset-bottom))]"
    : "bottom-[calc(5rem+env(safe-area-inset-bottom))]";
  const placement = surface === "desktop" ? "bottom-6 right-6" : `inset-x-3 mx-auto ${mobileBottom}`;
  return <aside className={`fixed z-[60] flex max-w-xl items-start gap-3 border border-line bg-paper p-4 text-ink shadow-lg ${placement}`}><Database className="mt-0.5 shrink-0" size={18} /><div className="min-w-0 flex-1"><p className="text-xs font-bold">빠른 로딩을 위한 공개 캐시</p><p className="mt-1 text-[11px] leading-5 text-muted">공개 상품·이미지·정적 리소스만 기기에 저장합니다. 계정·주문·결제 정보는 저장하지 않습니다.</p><div className="mt-3 flex gap-2"><button className="inline-flex items-center gap-1 bg-ink px-3 py-2 text-[11px] font-bold text-paper" onClick={accept} type="button"><Check size={13} /> 허용</button><button className="inline-flex items-center gap-1 border border-line px-3 py-2 text-[11px] font-bold" onClick={decline} type="button"><X size={13} /> 거부</button></div></div></aside>;
}

export function CacheConsentSettings() {
  const consent = useSyncExternalStore(subscribeToConsent, readCacheConsent, () => "unknown" as CacheConsent);
  if (consent === "unknown") return null;
  const reset = () => { clearCacheConsent(); void clearPublicCache().catch(() => undefined); };
  return <button className="text-left text-xs text-muted underline" onClick={reset} type="button">캐시 설정 변경</button>;
}
