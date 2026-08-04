"use client";

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application Error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center bg-[#fbfaf7] dark:bg-[#15181c] text-[#1c1d1f] dark:text-[#f2f3f5]">
      <div className="max-w-md space-y-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-8 shadow-sm">
        <h2 className="text-xl font-bold tracking-tight">일시적인 오류가 발생했습니다</h2>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          요청을 처리하는 도중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.
        </p>
        <button
          onClick={() => reset()}
          className="inline-flex items-center justify-center rounded-lg bg-stone-900 dark:bg-stone-100 px-4 py-2.5 text-sm font-medium text-white dark:text-stone-900 transition hover:bg-stone-800 dark:hover:bg-stone-200"
        >
          다시 시도
        </button>
      </div>
    </div>
  );
}
