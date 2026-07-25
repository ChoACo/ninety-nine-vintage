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
import { useAdminNavigationAccess } from "@/hooks/useAdminNavigationAccess";
import {
  NOTIFICATION_CATEGORY_OPTIONS,
  type NotificationPreferenceToggleKey,
} from "@/lib/notifications/preferences";

const STAFF_NOTIFICATION_PREFERENCE_KEYS =
  new Set<NotificationPreferenceToggleKey>([
    "chatEnabled",
    "paymentVerificationEnabled",
    "shippingRequestEnabled",
    "systemEnabled",
  ]);

const MEMBER_NOTIFICATION_PREFERENCE_KEYS =
  new Set<NotificationPreferenceToggleKey>([
    "auctionEnabled",
    "chatEnabled",
    "shipmentEnabled",
    "systemEnabled",
  ]);

export function MobilePwaControls({
  detailed = false,
}: {
  detailed?: boolean;
}) {
  const state = useMobilePwa();
  const notificationExperience = useNotificationExperience();
  const access = useAdminNavigationAccess();
  if (!state?.isMobile) return null;

  const pushStatus = (() => {
    switch (state.pushState) {
      case "busy":
        return {
          description: "웹앱 알림 상태를 변경하고 있습니다.",
          label: "알림 설정 중",
          receiving: false,
        };
      case "enabled":
        return {
          description: "웹앱을 닫아도 허용한 새 소식을 받습니다.",
          label: "알림 받는 중",
          receiving: true,
        };
      case "denied":
        return {
          description: "기기 설정에서 이 웹앱의 알림 권한을 허용해 주세요.",
          label: "기기에서 알림 차단됨",
          receiving: false,
        };
      case "signed_out":
        return {
          description: "로그인하면 계정에 맞는 알림을 설정할 수 있습니다.",
          label: "알림 받지 않는 중",
          receiving: false,
        };
      case "install_required":
        return {
          description: "iPhone·iPad는 Safari에서 홈 화면에 추가한 뒤 시스템 알림을 켤 수 있습니다.",
          label: "앱 설치 후 알림 가능",
          receiving: false,
        };
      case "unsupported":
        return {
          description: "현재 브라우저에서는 알림 기능을 사용할 수 없습니다.",
          label: "알림 지원 안 됨",
          receiving: false,
        };
      case "error":
        return {
          description: "알림 연결을 복구하지 못했습니다. 다시 켜 주세요.",
          label: "알림 연결 확인 필요",
          receiving: false,
        };
      default:
        return {
          description: "알림을 켜면 웹앱을 닫아도 새 소식을 받을 수 있습니다.",
          label: "알림 받지 않는 중",
          receiving: false,
        };
    }
  })();
  const PushIcon =
    pushStatus.receiving
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
    state.pushState === "install_required" ||
    state.pushState === "denied";
  const visibleCategoryOptions = NOTIFICATION_CATEGORY_OPTIONS.filter(
    (option) =>
      access.roleCode === "owner" ||
      (access.roleCode === "operator" || access.roleCode === "employee"
        ? STAFF_NOTIFICATION_PREFERENCE_KEYS.has(option.key)
        : MEMBER_NOTIFICATION_PREFERENCE_KEYS.has(option.key)),
  );

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
      {state.pushState !== "install_required" ? (
        <>
          <div
            className={`border-2 p-4 ${
              pushStatus.receiving
                ? "border-emerald-600 bg-emerald-50 text-emerald-950"
                : "border-line bg-surface"
            }`}
          >
            <p className="flex items-center gap-2 text-sm font-black">
              <PushIcon
                className={state.pushState === "busy" ? "animate-spin" : undefined}
                size={17}
              />
              {pushStatus.label}
            </p>
            <p className="mt-2 text-[11px] leading-5 text-muted">
              {pushStatus.description}
            </p>
          </div>
          <button
            className={`inline-flex min-h-11 w-full items-center justify-center gap-2 px-4 text-xs font-black disabled:opacity-45 ${
              pushStatus.receiving
                ? "border border-rose-300 bg-rose-50 text-rose-800"
                : "bg-ink text-paper"
            }`}
            disabled={pushDisabled}
            onClick={() => void state.togglePush()}
            type="button"
          >
            {pushStatus.receiving ? <BellOff size={16} /> : <Bell size={16} />}
            {state.pushState === "denied"
              ? "기기 설정에서 알림 허용 필요"
              : pushStatus.receiving
                ? "알림 끄기"
                : "알림 켜기"}
          </button>
          {state.pushState === "enabled" && (
            <button
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 border border-ink px-4 text-xs font-black"
              onClick={() => void state.testPush().catch(() => undefined)}
              type="button"
            >
              <Bell size={16} /> 시험 알림 보내기
            </button>
          )}
        </>
      ) : (
        <div
          className={`border-2 p-4 ${
            pushStatus.receiving
              ? "border-emerald-600 bg-emerald-50 text-emerald-950"
              : "border-line bg-surface"
          }`}
        >
          <p className="flex items-center gap-2 text-sm font-black">
            {pushStatus.receiving ? <Bell size={17} /> : <BellOff size={17} />}
            {pushStatus.label}
          </p>
          <p className="mt-2 text-[11px] leading-5 text-muted">
            {pushStatus.description}
          </p>
        </div>
      )}
      {detailed && (
        <>
          <p className="flex gap-2 text-[11px] leading-5 text-muted">
            <Smartphone className="mt-0.5 shrink-0" size={14} />
            {state.standalone
              ? "설치된 웹앱이므로 화면을 닫아도 허용한 알림을 모바일 상태창에서 받을 수 있습니다."
              : state.pushState === "install_required"
                ? "iPhone·iPad는 Safari 공유 메뉴의 ‘홈 화면에 추가’가 필요합니다."
                : "Android Chrome에서는 앱을 설치하지 않아도 허용한 알림을 모바일 상태창에서 받을 수 있습니다."}
          </p>
          {preferences && (
            <div className="mt-3 divide-y divide-line border-y border-line">
              <label className="flex min-h-14 items-center justify-between gap-4 py-3 text-xs font-bold">
                <span>
                  사이트 접속 중 알림
                  <small className="mt-1 block font-normal leading-4 text-muted">
                    웹앱을 보고 있을 때 알림 팝업 표시
                  </small>
                </span>
                <span className="flex items-center gap-2">
                  <span className={preferences.foregroundEnabled ? "text-emerald-700" : "text-muted"}>
                    {preferences.foregroundEnabled ? "켜짐" : "꺼짐"}
                  </span>
                  <input
                    checked={preferences.foregroundEnabled}
                    className="size-5 accent-black"
                    disabled={notificationExperience.busy}
                    onChange={() => void togglePreference("foregroundEnabled")}
                    type="checkbox"
                  />
                </span>
              </label>
              {visibleCategoryOptions.map((option) => (
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
                  <span className="flex items-center gap-2">
                    <span className={preferences[option.key] ? "text-emerald-700" : "text-muted"}>
                      {preferences[option.key] ? "켜짐" : "꺼짐"}
                    </span>
                    <input
                      checked={preferences[option.key]}
                      className="size-5 accent-black"
                      disabled={notificationExperience.busy}
                      onChange={() => void togglePreference(option.key)}
                      type="checkbox"
                    />
                  </span>
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
