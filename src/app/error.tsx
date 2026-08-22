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
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center text-foreground">
      <div className="max-w-md space-y-4 rounded-xl border border-border dark:border-stone-800 bg-card dark:bg-stone-900 p-8 shadow-sm">
        <h2 className="text-xl font-bold tracking-tight">일시적인 오류가 발생했습니다</h2>
        <p className="text-sm text-stone-600 dark:text-zinc-500">
          요청을 처리하는 도중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.
        </p>
        <button
          onClick={() => reset()}
          className="inline-flex items-center justify-center rounded-lg bg-stone-900 dark:bg-stone-100 px-4 py-2.5 text-sm font-medium text-white dark:text-foreground transition hover:bg-stone-800 dark:hover:bg-stone-200"
        >
          다시 시도
        </button>
      </div>
    </div>
  );
}
