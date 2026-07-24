"use client";

import {
  Bell,
  BellOff,
  Download,
  LoaderCircle,
  Smartphone,
} from "lucide-react";
import { useMobilePwa } from "@/components/features/pwa/MobilePwaProvider";

export function MobilePwaControls({
  detailed = false,
}: {
  detailed?: boolean;
}) {
  const state = useMobilePwa();
  if (!state?.isMobile) return null;

  const pushLabel = (() => {
    switch (state.pushState) {
      case "busy":
        return "알림 설정 중";
      case "enabled":
        return "알림 받는 중";
      case "denied":
        return "알림 권한이 차단됨";
      case "signed_out":
        return "로그인 후 알림 받기";
      case "unsupported":
        return "알림을 지원하지 않음";
      default:
        return "새 소식 알림 받기";
    }
  })();
  const PushIcon =
    state.pushState === "enabled"
      ? Bell
      : state.pushState === "busy"
        ? LoaderCircle
        : BellOff;
  const pushDisabled =
    state.pushState === "busy" ||
    state.pushState === "signed_out" ||
    state.pushState === "unsupported" ||
    state.pushState === "denied";

  return (
    <div className="grid gap-2">
      {!state.installed && (
        <button
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 border border-line px-4 text-xs font-bold"
          onClick={() => void state.install()}
          type="button"
        >
          <Download size={16} /> 앱 설치하기
        </button>
      )}
      <button
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 border border-line px-4 text-xs font-bold disabled:opacity-45"
        disabled={pushDisabled}
        onClick={() => void state.togglePush()}
        type="button"
      >
        <PushIcon
          className={state.pushState === "busy" ? "animate-spin" : undefined}
          size={16}
        />
        {pushLabel}
      </button>
      {detailed && (
        <p className="flex gap-2 text-[11px] leading-5 text-muted">
          <Smartphone className="mt-0.5 shrink-0" size={14} />
          회원은 낙찰·채팅·송장 알림을, 운영자와 직원은 채팅·입금 확인·배송
          요청 알림을 받습니다.
        </p>
      )}
      {state.installHelp && (
        <p className="text-[11px] leading-5 text-muted">{state.installHelp}</p>
      )}
      {state.pushError && (
        <p className="text-[11px] leading-5 text-danger">{state.pushError}</p>
      )}
    </div>
  );
}
