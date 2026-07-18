"use client";

interface ToastProps {
  message: string;
  visible: boolean;
  onDismiss: () => void;
  dismissible?: boolean;
}

export function Toast({
  message,
  visible,
  onDismiss,
  dismissible = true,
}: ToastProps) {
  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-3 top-3 z-[120] flex justify-center sm:inset-x-auto sm:right-6 sm:top-6"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="animate-fade-in-up pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-lg border border-white/10 bg-[#181817] px-3.5 py-3 text-sm font-semibold text-[#f7f3e9] shadow-[0_18px_48px_rgba(0,0,0,0.3)] sm:min-w-80">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#e1e9e3] text-[#24533a]" aria-hidden="true">
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-3.5"
          >
            <path d="m4.5 10 3.2 3.2 7.8-7.8" />
          </svg>
        </span>
        <p className="min-w-0 flex-1 break-keep leading-5">{message}</p>
        {dismissible ? (
          <button
            type="button"
            onClick={onDismiss}
            className="ml-1 grid size-7 shrink-0 place-items-center rounded-md text-white/55 transition-all duration-200 ease-out hover:scale-105 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            aria-label="알림 닫기"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              className="size-4"
            >
              <path d="m5 5 10 10M15 5 5 15" />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
  );
}
