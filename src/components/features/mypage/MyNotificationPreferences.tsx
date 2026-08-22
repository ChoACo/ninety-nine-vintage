"use client";

import { useNotificationExperience } from "@/components/features/notifications/NotificationExperienceProvider";
import type { NotificationPreferenceToggleKey } from "@/lib/notifications/preferences";

const OPTIONS: ReadonlyArray<{
  description: string;
  key: NotificationPreferenceToggleKey;
  label: string;
}> = [
  {
    key: "auctionEnabled",
    label: "라이브 옥션 오픈 및 상위 입찰 알림",
    description: "참여 중인 경매 상태 및 매일 밤 10시 옥션 시작 알림",
  },
  {
    key: "shipmentEnabled",
    label: "보관함 만료 D-3 알림",
    description: "14일 무료 보관 기한 만료 3일 전 알림톡 발송",
  },
  {
    key: "systemEnabled",
    label: "찜한 상품 가격 인하 알림",
    description: "관심 아카이브의 가격 변동 시 실시간 알림",
  },
];

export function MyNotificationPreferences() {
  const experience = useNotificationExperience();
  const preferences = experience?.preferences;

  if (!experience || experience.loading || !preferences) {
    return (
      <div
        aria-label="알림 설정 불러오는 중"
        className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5"
      >
        {OPTIONS.map((option) => (
          <div
            className="h-12 animate-pulse rounded-xl bg-zinc-800"
            key={option.key}
          />
        ))}
      </div>
    );
  }

  const toggle = (key: NotificationPreferenceToggleKey) => {
    void experience
      .savePreferences({
        ...preferences,
        [key]: !preferences[key],
        consentState: "granted",
      })
      .catch(() => undefined);
  };

  return (
    <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
      {OPTIONS.map((option) => {
        const checked = preferences[option.key];
        return (
          <div
            className="flex min-h-14 items-center justify-between gap-4"
            key={option.key}
          >
            <div>
              <p className="text-sm font-medium text-zinc-200">
                {option.label}
              </p>
              <p className="mt-1 text-xs leading-5 text-zinc-400">
                {option.description}
              </p>
            </div>
            <button
              aria-checked={checked}
              aria-label={option.label}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${checked ? "bg-emerald-500" : "bg-zinc-700"}`}
              disabled={experience.busy}
              onClick={() => toggle(option.key)}
              role="switch"
              type="button"
            >
              <span
                className={`absolute top-1 size-5 rounded-full bg-card shadow transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`}
              />
            </button>
          </div>
        );
      })}
      {experience.error ? (
        <p className="text-xs text-rose-400">{experience.error}</p>
      ) : null}
    </div>
  );
}
