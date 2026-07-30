"use client";

import { LoaderCircle } from "lucide-react";
import { useSimpleMode } from "@/components/features/accessibility/SimpleModeProvider";

export function SimpleModeToggle({
  className = "",
  detailed = false,
}: {
  className?: string;
  detailed?: boolean;
}) {
  const simpleMode = useSimpleMode();
  return (
    <div className={className}>
      <button
        aria-pressed={simpleMode.enabled}
        className={`flex min-h-12 w-full items-center justify-center gap-2 border-2 px-4 text-sm font-black ${
          simpleMode.enabled
            ? "border-emerald-700 bg-emerald-50 text-emerald-950"
            : "border-ink bg-paper text-ink"
        } disabled:opacity-50`}
        disabled={!simpleMode.hydrated || simpleMode.saving}
        onClick={() => void simpleMode.toggle().catch(() => undefined)}
        type="button"
      >
        {simpleMode.saving && <LoaderCircle className="animate-spin" size={19} />}
        {simpleMode.enabled ? "간편모드 끄기" : "간편모드 켜기"}
      </button>
      {detailed && (
        <p className="mt-2 text-xs leading-5 text-muted">
          {simpleMode.enabled
            ? "큰 글자와 큰 버튼으로 입찰·구매·결제·배송 메뉴만 간단히 표시합니다."
            : "켜면 복잡한 메뉴를 줄이고 쇼핑에 필요한 기능만 크게 표시합니다."}
        </p>
      )}
      {simpleMode.error && (
        <p className="mt-2 text-xs font-bold leading-5 text-rose-700" role="alert">
          {simpleMode.error}
        </p>
      )}
    </div>
  );
}
