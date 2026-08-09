"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNotificationExperience } from "@/components/features/notifications/NotificationExperienceProvider";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import {
  ANDROID_CHROME_STORE_URL,
  buildAndroidChromeIntent,
  buildIosChromeUrl,
  detectInstallBrowser,
  getInstallFallbackMode,
  IOS_CHROME_STORE_URL,
  type InstallFallbackMode,
  type MobilePlatform,
} from "@/lib/pwa/chromeLaunch";
import {
  type BeforeInstallPromptEvent,
  disableWebPush,
  enableWebPush,
  getWebPushClientMode,
  isActualMobileDevice,
  isInstalledWebApp,
  isIosMobile,
  registerMobileServiceWorker,
  syncExistingWebPush,
  showTestWebPushNotification,
} from "@/lib/webPush/client";

type PushState =
  | "unsupported"
  | "signed_out"
  | "default"
  | "denied"
  | "enabled"
  | "disabled"
  | "install_required"
  | "busy"
  | "error";

export interface MobilePwaState {
  install(): Promise<void>;
  installActionLabel: string;
  installHelp: string | null;
  installStoreUrl: string | null;
  installed: boolean;
  isMobile: boolean;
  standalone: boolean;
  pushError: string | null;
  pushState: PushState;
  testPush(): Promise<void>;
  togglePush(): Promise<void>;
}

const MobilePwaContext = createContext<MobilePwaState | null>(null);

export function MobilePwaProvider({ children }: { children: ReactNode }) {
  const { session } = useSupabaseSession();
  const notificationExperience = useNotificationExperience();
  const [isMobile, setIsMobile] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installFallbackMode, setInstallFallbackMode] =
    useState<InstallFallbackMode>("manual");
  const [mobilePlatform, setMobilePlatform] =
    useState<MobilePlatform>("other");
  const [installHelp, setInstallHelp] = useState<string | null>(null);
  const [installStoreUrl, setInstallStoreUrl] = useState<string | null>(null);
  const [pushState, setPushState] = useState<PushState>("unsupported");
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const mobile = isActualMobileDevice();
    queueMicrotask(() => {
      if (!active) return;
      setIsMobile(mobile);
      const runningStandalone = isInstalledWebApp();
      setInstalled(runningStandalone);
      setStandalone(runningStandalone);
      const browserContext = detectInstallBrowser(
        navigator.userAgent,
        navigator.platform,
        navigator.maxTouchPoints,
      );
      setInstallFallbackMode(getInstallFallbackMode(browserContext));
      setMobilePlatform(browserContext.platform);
    });
    if (!mobile) {
      return () => {
        active = false;
      };
    }

    void registerMobileServiceWorker().catch(() => undefined);
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setInstallStoreUrl(null);
    };
    const captureInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setInstallHelp(null);
    };
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", captureInstalled);
    return () => {
      active = false;
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", captureInstalled);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const publish = (nextState: PushState) => {
      queueMicrotask(() => {
        if (active) setPushState(nextState);
      });
    };
    if (!isMobile || !("Notification" in window) || !("PushManager" in window)) {
      publish("unsupported");
      return () => {
        active = false;
      };
    }
    if (!getWebPushClientMode()) {
      publish(isIosMobile() && !standalone ? "install_required" : "unsupported");
      return () => {
        active = false;
      };
    }
    if (!session) {
      publish("signed_out");
      return () => {
        active = false;
      };
    }
    if (
      notificationExperience?.preferences?.consentState !== "granted" ||
      !notificationExperience.preferences.backgroundPushEnabled
    ) {
      publish("disabled");
      return () => {
        active = false;
      };
    }
    if (Notification.permission === "denied") {
      publish("denied");
      return () => {
        active = false;
      };
    }
    if (Notification.permission !== "granted") {
      publish("default");
      return () => {
        active = false;
      };
    }

    queueMicrotask(() => {
      if (active) setPushError(null);
    });
    void syncExistingWebPush(session.access_token)
      .then(async (synced) => {
        if (synced) return true;
        await enableWebPush(session.access_token);
        return true;
      })
      .then((enabled) => {
        publish(enabled ? "enabled" : "disabled");
      })
      .catch((syncError: unknown) => {
        publish("error");
        if (active) {
          setPushError(
            syncError instanceof Error
              ? syncError.message
              : "웹앱 알림 구독을 복구하지 못했습니다.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [
    isMobile,
    notificationExperience?.preferences,
    session,
    standalone,
  ]);

  const install = useCallback(async () => {
    setInstallHelp(null);
    setInstallStoreUrl(null);
    if (installPrompt) {
      try {
        await installPrompt.prompt();
        const choice = await installPrompt.userChoice;
        setInstallPrompt(null);
        if (choice.outcome === "dismissed") {
          setInstallHelp(
            "설치를 취소했습니다. 다시 설치하려면 Chrome 메뉴(⋮)의 ‘앱 설치’를 이용해 주세요.",
          );
        }
      } catch {
        setInstallPrompt(null);
        setInstallHelp(
          "설치창을 열지 못했습니다. Chrome 메뉴(⋮)에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택해 주세요.",
        );
      }
      return;
    }

    if (installFallbackMode === "open_chrome") {
      if (mobilePlatform === "android") {
        const chromeIntent = buildAndroidChromeIntent(window.location.href);
        setInstallHelp(
          "Chrome으로 이동합니다. 열린 페이지에서 ‘앱 설치하기’를 다시 눌러 주세요. Chrome이 없으면 설치 화면으로 연결됩니다.",
        );
        setInstallStoreUrl(ANDROID_CHROME_STORE_URL);
        if (chromeIntent) window.location.assign(chromeIntent);
        return;
      }
      if (mobilePlatform === "ios") {
        const chromeUrl = buildIosChromeUrl(window.location.href);
        setInstallHelp(
          "Chrome으로 이동합니다. Chrome의 공유 메뉴에서 ‘홈 화면에 추가’를 선택해 주세요. Chrome이 열리지 않으면 아래에서 Chrome을 먼저 설치해 주세요.",
        );
        setInstallStoreUrl(IOS_CHROME_STORE_URL);
        if (chromeUrl) window.location.assign(chromeUrl);
        return;
      }
    }

    setInstallHelp(
      isIosMobile()
        ? "브라우저의 공유 버튼을 누른 뒤 ‘홈 화면에 추가’를 선택해 주세요."
        : "Chrome 메뉴(⋮)에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택해 주세요.",
    );
  }, [installFallbackMode, installPrompt, mobilePlatform]);

  const installActionLabel = installPrompt
    ? "앱 설치하기"
    : installFallbackMode === "open_chrome"
      ? "Chrome에서 열고 설치"
      : "앱 설치 방법 보기";

  const togglePush = useCallback(async () => {
    if (
      !session ||
      !notificationExperience?.preferences ||
      !getWebPushClientMode() ||
      pushState === "busy"
    ) {
      return;
    }
    setPushState("busy");
    setPushError(null);
    try {
      if (Notification.permission === "granted" && pushState === "enabled") {
        await disableWebPush(session.access_token);
        await notificationExperience.savePreferences({
          ...notificationExperience.preferences,
          backgroundPushEnabled: false,
          consentState: "granted",
        });
        setPushState("disabled");
      } else {
        await enableWebPush(session.access_token);
        await notificationExperience.savePreferences({
          ...notificationExperience.preferences,
          backgroundPushEnabled: true,
          consentState: "granted",
        });
        setPushState("enabled");
      }
    } catch (error) {
      setPushState(
        "Notification" in window && Notification.permission === "denied"
          ? "denied"
          : "error",
      );
      setPushError(
        error instanceof Error
          ? error.message
          : "알림 설정을 완료하지 못했습니다.",
      );
    }
  }, [notificationExperience, pushState, session]);

  const testPush = useCallback(async () => {
    setPushError(null);
    try {
      if (!session) throw new Error("로그인 후 시험 알림을 보낼 수 있습니다.");
      await showTestWebPushNotification(session.access_token);
    } catch (error) {
      setPushError(
        error instanceof Error ? error.message : "시험 알림을 표시하지 못했습니다.",
      );
      throw error;
    }
  }, [session]);

  const value = useMemo(
    () => ({
      install,
      installActionLabel,
      installHelp,
      installStoreUrl,
      installed,
      isMobile,
      standalone,
      pushError,
      pushState,
      testPush,
      togglePush,
    }),
    [
      install,
      installActionLabel,
      installHelp,
      installStoreUrl,
      installed,
      isMobile,
      standalone,
      pushError,
      pushState,
      testPush,
      togglePush,
    ],
  );

  return (
    <MobilePwaContext.Provider value={value}>
      {children}
    </MobilePwaContext.Provider>
  );
}

export function useMobilePwa() {
  return useContext(MobilePwaContext);
}
