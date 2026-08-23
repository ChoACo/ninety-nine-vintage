"use client";

import { RotateCcw } from "lucide-react";
import { useEffect } from "react";

export default function OperatorPlatformError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("operator_platform_render_failed", error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-3xl rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-zinc-100" role="alert">
      <h2 className="text-lg font-black">매장 설정 화면을 열지 못했습니다.</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-300">
        잠시 후 다시 시도해 주세요. 같은 문제가 계속되면 관리자에게 문의해
        주세요.
      </p>
      <button
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-300/40 px-4 text-xs font-bold hover:bg-rose-500/10"
        onClick={reset}
        type="button"
      >
        <RotateCcw size={15} /> 다시 시도
      </button>
    </div>
  );
}
