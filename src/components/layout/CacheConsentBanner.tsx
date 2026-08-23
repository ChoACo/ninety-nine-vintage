"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Database, ShieldCheck, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { CACHE_CONSENT_EVENT, readCacheConsent, writeCacheConsent, type CacheConsent } from "@/lib/cacheConsent";

const CACHE_PREFIX = "ninetynine-public-";
const CACHE_CONSENT_NAME = "ninetynine-cache-consent-v1";
const isLoopbackHost = () =>
  ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
const subscribeToConsent = (onStoreChange: () => void) => {
  window.addEventListener(CACHE_CONSENT_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(CACHE_CONSENT_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
};

async function registerPublicCache() {
  if (isLoopbackHost()) return;
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
  const cacheNames = await caches.keys();
  await Promise.all([
    ...cacheNames
      .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX))
      .map((cacheName) => caches.delete(cacheName)),
    caches.delete(CACHE_CONSENT_NAME),
  ]);
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

  if (pathname === "/") return null;
  const detailHasFixedMobileAction = /^\/(?:m\/)?(?:auction|live)\/[^/]+$/.test(pathname);
  const accept = () => {
    setConsent("accepted");
    writeCacheConsent("accepted");
    void registerPublicCache().catch(() => undefined);
  };
  const decline = () => {
    setConsent("declined");
    writeCacheConsent("declined");
    void clearPublicCache().catch(() => undefined);
  };
  const mobilePlacement = detailHasFixedMobileAction
    ? "inset-x-3 top-[calc(5rem+env(safe-area-inset-top))] mx-auto"
    : "inset-x-3 bottom-[calc(10.5rem+env(safe-area-inset-bottom))] mx-auto";
  const placement = surface === "desktop" ? "bottom-6 right-24" : mobilePlacement;
  return <AnimatePresence>{consent === "unknown" && <motion.aside animate={{ opacity: 1, y: 0 }} aria-label="공개 캐시 사용 선택" className={`theme-invariant-dark fixed z-[80] flex w-[calc(100%-1.5rem)] max-w-lg items-start gap-3 rounded-2xl border border-zinc-700 bg-zinc-950/95 p-4 text-white shadow-2xl shadow-black/30 backdrop-blur-xl ${placement}`} exit={{ opacity: 0, y: 16 }} initial={{ opacity: 0, y: 16 }} role="region" transition={{ duration: .24, ease: "easeOut" }}><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-zinc-800 text-emerald-400"><Database size={17} strokeWidth={1.75} /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="text-xs font-bold">빠른 로딩을 위한 공개 캐시</p><span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-1 text-[9px] font-bold text-emerald-300"><ShieldCheck size={11} strokeWidth={1.75} /> 개인정보 제외</span></div><p className="mt-1.5 text-[11px] leading-5 text-zinc-400">공개 상품·이미지·정적 리소스만 기기에 저장합니다. 계정·주문·결제 정보는 저장하지 않습니다.</p><div className="mt-3 flex gap-2"><button className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-card px-4 text-[11px] font-bold text-zinc-950 transition-all hover:-translate-y-0.5 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-emerald-400 active:scale-[.98]" onClick={accept} type="button"><Check size={13} strokeWidth={1.75} /> 허용</button><button className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-zinc-700 px-4 text-[11px] font-bold text-zinc-300 transition-colors hover:border-zinc-400 hover:text-white focus-visible:ring-2 focus-visible:ring-white" onClick={decline} type="button"><X size={13} strokeWidth={1.75} /> 거부</button></div></div></motion.aside>}</AnimatePresence>;
}

export function CacheConsentSettings() {
  const consent = useSyncExternalStore(subscribeToConsent, readCacheConsent, () => "unknown" as CacheConsent);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const updateConsent = async (nextConsent: Exclude<CacheConsent, "unknown">) => {
    setBusy(true);
    setMessage("");
    try {
      writeCacheConsent(nextConsent);
      if (nextConsent === "accepted") {
        await registerPublicCache();
        setMessage("공개 캐시를 사용하도록 설정했습니다.");
      } else {
        await clearPublicCache();
        setMessage("공개 캐시를 사용하지 않으며 저장된 캐시를 비웠습니다.");
      }
    } catch {
      setMessage("캐시 설정을 변경하지 못했습니다. 브라우저 설정을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  };
  const clearStoredCache = async () => {
    setBusy(true);
    setMessage("");
    try {
      await clearPublicCache();
      setMessage("기기에 저장된 공개 캐시를 비웠습니다.");
    } catch {
      setMessage("저장된 캐시를 비우지 못했습니다. 브라우저 설정을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  };
  const status = consent === "accepted" ? "사용 중" : consent === "declined" ? "사용 안 함" : "아직 선택하지 않음";
  return (
    <div className="max-w-md">
      <p className="text-xs font-bold">현재 상태: <span className="text-muted">{status}</span></p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <button aria-pressed={consent === "accepted"} className="min-h-11 border border-line px-3 text-xs font-bold disabled:opacity-50" disabled={busy} onClick={() => void updateConsent("accepted")} type="button">캐시 사용</button>
        <button aria-pressed={consent === "declined"} className="min-h-11 border border-line px-3 text-xs font-bold disabled:opacity-50" disabled={busy} onClick={() => void updateConsent("declined")} type="button">사용 안 함</button>
        <button className="min-h-11 border border-line px-3 text-xs font-bold disabled:opacity-50" disabled={busy} onClick={() => void clearStoredCache()} type="button">저장 캐시 비우기</button>
      </div>
      {message && <p aria-live="polite" className="mt-3 text-xs leading-5 text-muted">{message}</p>}
    </div>
  );
}
