"use client";

import { Download, Share2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useMobilePwa } from "@/components/features/pwa/MobilePwaProvider";

const DISMISS_KEY = "ninety-nine:pwa-install-prompt-dismissed";

export function PwaInstallPrompt() {
  const state = useMobilePwa();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        setDismissed(window.localStorage.getItem(DISMISS_KEY) === "true");
      } catch {
        setDismissed(false);
      }
    });
  }, []);

  if (!state?.isMobile || state.installed || dismissed) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, "true");
    } catch {}
    setDismissed(true);
  };

  return (
    <>
      <aside
        aria-label="99빈티지 앱 설치 안내"
        className="fixed inset-x-4 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-[180] mx-auto max-w-lg rounded-2xl border border-line bg-paper/95 p-4 text-ink shadow-2xl backdrop-blur-xl"
      >
        <button
          aria-label="앱 설치 안내 닫기"
          className="absolute right-2 top-2 grid size-9 place-items-center rounded-full text-muted hover:bg-surface hover:text-ink"
          onClick={dismiss}
          type="button"
        >
          <X size={16} strokeWidth={1.75} />
        </button>
        <div className="pr-9">
          <p className="text-sm font-black">99빈티지 앱 설치</p>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            실시간 입찰 경쟁과 보관 만료 알림을 모바일 상태창에서 놓치지 마세요.
          </p>
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-ink px-4 text-xs font-black text-paper"
            onClick={() => void state.install()}
            type="button"
          >
            <Download size={15} strokeWidth={1.75} /> {state.installActionLabel}
          </button>
          <button
            className="min-h-11 rounded-xl border border-line px-4 text-xs font-bold text-muted hover:text-ink"
            onClick={dismiss}
            type="button"
          >
            나중에
          </button>
        </div>
      </aside>
      {state.installHelp && (
        <div
          aria-labelledby="pwa-install-guide-title"
          aria-modal="true"
          className="fixed inset-0 z-[220] grid place-items-end bg-black/60 p-4 sm:place-items-center"
          role="dialog"
        >
          <section className="w-full max-w-md rounded-3xl border border-line bg-paper p-6 text-ink shadow-2xl">
            <Share2 size={24} strokeWidth={1.75} />
            <h2 className="mt-4 text-lg font-black" id="pwa-install-guide-title">홈 화면에 앱 추가하기</h2>
            <p className="mt-3 text-sm leading-6 text-muted">{state.installHelp}</p>
            <p className="mt-3 rounded-xl bg-surface p-3 text-xs leading-5">
              iPhone·iPad에서는 Safari 하단 공유 버튼을 누른 후 ‘홈 화면에 추가’를 선택하면 설치된 앱에서 실시간 알림을 받을 수 있습니다.
            </p>
            <button
              className="mt-5 min-h-11 w-full rounded-xl bg-ink px-4 text-xs font-black text-paper"
              onClick={dismiss}
              type="button"
            >
              확인
            </button>
          </section>
        </div>
      )}
    </>
  );
}
