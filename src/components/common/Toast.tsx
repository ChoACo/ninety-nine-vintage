"use client";

interface ToastProps {
  message: string;
  visible: boolean;
  onDismiss: () => void;
}

export function Toast({ message, visible, onDismiss }: ToastProps) {
  if (!visible) return null;

  return (
    <div className="fixed inset-x-4 top-4 z-[120] flex justify-center sm:top-6" role="status" aria-live="polite">
      <div className="animate-fade-in-up flex max-w-lg items-center gap-3 rounded-2xl border border-white/70 bg-[#3f514b]/95 px-4 py-3 text-sm font-bold text-white shadow-[0_18px_50px_rgba(47,65,58,0.25)] backdrop-blur">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#dff1e8] text-[#3f6c58]" aria-hidden="true">
          ✓
        </span>
        <p className="leading-5">{message}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-lg text-white/75 transition hover:bg-white/10 hover:text-white"
          aria-label="알림 닫기"
        >
          ×
        </button>
      </div>
    </div>
  );
}
