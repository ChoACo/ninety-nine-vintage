"use client";

import { Bell, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  isNotificationKindEnabled,
  type NotificationPreferences,
  type NotificationPreferencesResponse,
} from "@/lib/notifications/preferences";
import {
  enableWebPush,
  getWebPushClientMode,
} from "@/lib/webPush/client";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface ForegroundNotification {
  body: string;
  href: string;
  id: string;
  kind: string;
  title: string;
}

interface NotificationExperienceState {
  busy: boolean;
  error: string | null;
  loading: boolean;
  preferences: NotificationPreferences | null;
  savePreferences(
    preferences: NotificationPreferences,
  ): Promise<NotificationPreferences>;
}

const NotificationExperienceContext =
  createContext<NotificationExperienceState | null>(null);

function mobileHref(href: string, pathname: string) {
  if (!pathname.startsWith("/m")) return href;
  if (href === "/home") return "/m/home";
  if (href.startsWith("/account") || href.startsWith("/chat")) {
    return `/m${href}`;
  }
  return href;
}

async function readResponseError(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | { message?: string }
    | null;
  return payload?.message || "알림 설정을 저장하지 못했습니다.";
}

export function NotificationExperienceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { session } = useSupabaseSession();
  const accessToken = session?.access_token;
  const userId = session?.user.id;
  const [preferences, setPreferences] =
    useState<NotificationPreferences | null>(null);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ForegroundNotification | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (!accessToken || !userId) {
      queueMicrotask(() => {
        if (!active) return;
        setPreferences(null);
        setLoadedUserId(null);
        setError(null);
      });
      return () => {
        active = false;
      };
    }
    const timer = window.setTimeout(() => {
      void fetch("/api/notifications/preferences", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(await readResponseError(response));
          return (await response.json()) as NotificationPreferencesResponse;
        })
        .then((payload) => {
          if (!active) return;
          setPreferences(payload.preferences);
          setLoadedUserId(userId);
        })
        .catch(() => {
          if (!active || controller.signal.aborted) return;
          setError("알림 설정을 불러오지 못했습니다.");
          setLoadedUserId(userId);
        });
    }, 0);
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [accessToken, userId]);

  const savePreferences = useCallback(
    async (next: NotificationPreferences) => {
      if (!accessToken) throw new Error("로그인 후 알림을 설정해 주세요.");
      setBusy(true);
      setError(null);
      try {
        const response = await fetch("/api/notifications/preferences", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(next),
        });
        if (!response.ok) throw new Error(await readResponseError(response));
        const payload =
          (await response.json()) as NotificationPreferencesResponse;
        setPreferences(payload.preferences);
        window.dispatchEvent(
          new CustomEvent("ninety-nine:notification-preferences-changed", {
            detail: payload.preferences,
          }),
        );
        return payload.preferences;
      } catch (saveError) {
        const message =
          saveError instanceof Error
            ? saveError.message
            : "알림 설정을 저장하지 못했습니다.";
        setError(message);
        throw saveError;
      } finally {
        setBusy(false);
      }
    },
    [accessToken],
  );

  useEffect(() => {
    if (
      !userId ||
      !preferences ||
      !preferences.foregroundEnabled ||
      preferences.consentState !== "granted"
    ) {
      return;
    }
    const client = getSupabaseBrowserClient();
    const channel = client
      .channel(`foreground-notifications:${userId}:${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          filter: `member_id=eq.${userId}`,
          schema: "public",
          table: "notifications",
        },
        (payload) => {
          if (document.visibilityState !== "visible") return;
          if (
            getWebPushClientMode() &&
            preferences.backgroundPushEnabled &&
            Notification.permission === "granted"
          ) {
            return;
          }
          const notification = payload.new as Partial<ForegroundNotification>;
          if (
            typeof notification.id !== "string" ||
            typeof notification.kind !== "string" ||
            typeof notification.title !== "string" ||
            typeof notification.body !== "string" ||
            !isNotificationKindEnabled(preferences, notification.kind)
          ) {
            return;
          }
          setToast({
            body: notification.body,
            href:
              typeof notification.href === "string" &&
              notification.href.startsWith("/")
                ? notification.href
                : "/home",
            id: notification.id,
            kind: notification.kind,
            title: notification.title,
          });
        },
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [preferences, userId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const consentPending =
    Boolean(userId) &&
    loadedUserId === userId &&
    preferences?.consentState === "pending";
  const allowNotifications = async () => {
    if (!accessToken || busy) return;
    const next: NotificationPreferences = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      consentState: "granted",
    };
    const pushAttempt =
      getWebPushClientMode()
        ? enableWebPush(accessToken).then(
            () => true,
            () => false,
          )
        : Promise.resolve(true);
    try {
      await savePreferences(next);
      await pushAttempt;
    } catch {
      await pushAttempt;
    }
  };
  const declineNotifications = async () => {
    if (busy) return;
    try {
      await savePreferences({
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        backgroundPushEnabled: false,
        consentState: "declined",
        foregroundEnabled: false,
      });
    } catch {
      // The visible error keeps the consent choice available for retry.
    }
  };

  const value = useMemo<NotificationExperienceState>(
    () => ({
      busy,
      error,
      loading: Boolean(userId) && loadedUserId !== userId,
      preferences,
      savePreferences,
    }),
    [busy, error, loadedUserId, preferences, savePreferences, userId],
  );
  const toastHref = toast ? mobileHref(toast.href, pathname) : null;

  return (
    <NotificationExperienceContext.Provider value={value}>
      {children}
      {consentPending && (
        <div
          aria-labelledby="notification-consent-title"
          aria-modal="true"
          className="fixed inset-0 z-[230] grid place-items-center bg-black/55 p-4 backdrop-blur-sm"
          role="dialog"
        >
          <section className="w-full max-w-md border border-line bg-paper p-6 text-ink shadow-2xl sm:p-8">
            <p className="eyebrow text-muted">첫 가입 / 알림 설정</p>
            <h2
              className="mt-3 text-2xl font-black tracking-[-0.06em]"
              id="notification-consent-title"
            >
              필요한 소식을 알려드릴까요?
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              Android Chrome은 모바일 상태창 알림을 받을 수 있습니다.
              iPhone·iPad는 Safari에서 홈 화면에 추가한 뒤 설치한 앱에서
              상태창 알림을 받을 수 있습니다.
            </p>
            <p className="mt-3 text-xs leading-5 text-muted">
              모든 알림이 기본으로 켜지며, 웹앱 설정에서 종류별로 언제든
              변경할 수 있습니다.
            </p>
            {error && (
              <p className="mt-4 text-xs font-bold text-rose-700" role="alert">
                {error}
              </p>
            )}
            <div className="mt-6 grid gap-2">
              <button
                className="h-12 bg-ink text-sm font-bold text-paper disabled:opacity-40"
                disabled={busy}
                onClick={() => void allowNotifications()}
                type="button"
              >
                {busy ? "저장 중…" : "알림 허용"}
              </button>
              <button
                className="h-11 border border-line text-xs font-bold disabled:opacity-40"
                disabled={busy}
                onClick={() => void declineNotifications()}
                type="button"
              >
                허용하지 않음
              </button>
            </div>
          </section>
        </div>
      )}
      {toast && toastHref && (
        <aside
          aria-live="polite"
          className="fixed right-4 top-4 z-[140] w-[min(22rem,calc(100vw-2rem))] border border-ink bg-paper p-4 text-ink shadow-2xl"
          role="status"
        >
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-paper">
              <Bell size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black">{toast.title}</p>
              <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted">
                {toast.body}
              </p>
              <Link
                className="mt-3 inline-flex h-9 items-center bg-ink px-4 text-[11px] font-bold text-paper"
                href={toastHref}
                onClick={() => {
                  if (accessToken) {
                    void fetch("/api/notifications", {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({ notificationId: toast.id }),
                    });
                  }
                  setToast(null);
                }}
              >
                관련 화면으로 이동
              </Link>
            </div>
            <button
              aria-label="알림 닫기"
              className="grid size-9 shrink-0 place-items-center"
              onClick={() => setToast(null)}
              type="button"
            >
              <X size={17} />
            </button>
          </div>
        </aside>
      )}
    </NotificationExperienceContext.Provider>
  );
}

export function useNotificationExperience() {
  return useContext(NotificationExperienceContext);
}
