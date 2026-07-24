"use client";

import {
  Bell,
  BellOff,
  Download,
  LoaderCircle,
  Smartphone,
} from "lucide-react";
import { useNotificationExperience } from "@/components/features/notifications/NotificationExperienceProvider";
import { useMobilePwa } from "@/components/features/pwa/MobilePwaProvider";
import {
  NOTIFICATION_CATEGORY_OPTIONS,
  type NotificationPreferenceToggleKey,
} from "@/lib/notifications/preferences";

export function MobilePwaControls({
  detailed = false,
}: {
  detailed?: boolean;
}) {
  const state = useMobilePwa();
  const notificationExperience = useNotificationExperience();
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
      case "foreground_only":
        return "접속 중 알림만 사용";
      case "unsupported":
        return "알림을 지원하지 않음";
      default:
        return "웹앱 백그라운드 알림 켜기";
    }
  })();
  const PushIcon =
    state.pushState === "enabled"
      ? Bell
      : state.pushState === "busy"
        ? LoaderCircle
        : BellOff;
  const preferences = notificationExperience?.preferences;
  const pushDisabled =
    !preferences ||
    notificationExperience.loading ||
    notificationExperience.busy ||
    state.pushState === "busy" ||
    state.pushState === "signed_out" ||
    state.pushState === "unsupported" ||
    state.pushState === "foreground_only" ||
    state.pushState === "denied";

  const togglePreference = async (
    key: NotificationPreferenceToggleKey | "foregroundEnabled",
  ) => {
    if (!preferences || notificationExperience.busy) return;
    await notificationExperience
      .savePreferences({
        ...preferences,
        [key]: !preferences[key],
        consentState: "granted",
      })
      .catch(() => undefined);
  };

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
      {state.standalone ? (
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
      ) : (
        <div className="flex min-h-11 items-center justify-center gap-2 border border-line px-4 text-center text-xs font-bold text-muted">
          <Bell size={16} /> 사이트 접속 중 알림만 사용
        </div>
      )}
      {detailed && (
        <>
          <p className="flex gap-2 text-[11px] leading-5 text-muted">
            <Smartphone className="mt-0.5 shrink-0" size={14} />
            {state.standalone
              ? "설치된 웹앱이므로 화면을 닫아도 허용한 알림을 받을 수 있습니다."
              : "모바일 웹에서는 화면을 보고 있을 때만 알림이 표시됩니다. 백그라운드 알림은 앱 설치 후 사용할 수 있습니다."}
          </p>
          {state.standalone && preferences && (
            <div className="mt-3 divide-y divide-line border-y border-line">
              <label className="flex min-h-14 items-center justify-between gap-4 py-3 text-xs font-bold">
                <span>
                  사이트 접속 중 알림
                  <small className="mt-1 block font-normal leading-4 text-muted">
                    웹앱을 보고 있을 때 알림 팝업 표시
                  </small>
                </span>
                <input
                  checked={preferences.foregroundEnabled}
                  className="size-5 accent-black"
                  disabled={notificationExperience.busy}
                  onChange={() => void togglePreference("foregroundEnabled")}
                  type="checkbox"
                />
              </label>
              {NOTIFICATION_CATEGORY_OPTIONS.map((option) => (
                <label
                  className="flex min-h-14 items-center justify-between gap-4 py-3 text-xs font-bold"
                  key={option.key}
                >
                  <span>
                    {option.label}
                    <small className="mt-1 block font-normal leading-4 text-muted">
                      {option.description}
                    </small>
                  </span>
                  <input
                    checked={preferences[option.key]}
                    className="size-5 accent-black"
                    disabled={notificationExperience.busy}
                    onChange={() => void togglePreference(option.key)}
                    type="checkbox"
                  />
                </label>
              ))}
            </div>
          )}
        </>
      )}
      {state.installHelp && (
        <p className="text-[11px] leading-5 text-muted">{state.installHelp}</p>
      )}
      {state.pushError && (
        <p className="text-[11px] leading-5 text-danger">{state.pushError}</p>
      )}
      {notificationExperience?.error && (
        <p className="text-[11px] leading-5 text-danger">
          {notificationExperience.error}
        </p>
      )}
    </div>
  );
}
