"use client";

import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

export function RouteErrorFallback({
  description,
  error,
  homeHref,
  reset,
  title,
}: {
  description: string;
  error: Error & { digest?: string };
  homeHref: string;
  reset: () => void;
  title: string;
}) {
  useEffect(() => {
    console.error("route_render_failed", {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  return (
    <section
      className="mx-auto grid min-h-[50svh] w-full max-w-2xl place-items-center px-4 py-12 text-center"
      role="alert"
    >
      <div className="w-full rounded-2xl border border-line bg-paper p-6 shadow-sm sm:p-8">
        <p className="eyebrow text-muted">TEMPORARY ERROR</p>
        <h1 className="mt-3 text-2xl font-black tracking-[-.04em]">{title}</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-muted">
          {description}
        </p>
        {process.env.NODE_ENV !== "production" && error.digest && (
          <p className="mt-3 font-mono text-[10px] text-muted">
            digest: {error.digest}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-ink px-5 text-xs font-bold text-paper active:scale-[.98]"
            onClick={reset}
            type="button"
          >
            <RotateCcw size={15} /> 다시 시도
          </button>
          <Link
            className="inline-flex min-h-11 items-center rounded-xl border border-line px-5 text-xs font-bold active:scale-[.98]"
            href={homeHref}
          >
            안전한 화면으로 이동
          </Link>
        </div>
      </div>
    </section>
  );
}
