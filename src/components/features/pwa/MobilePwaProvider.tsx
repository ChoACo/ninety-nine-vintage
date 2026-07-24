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
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import {
  type BeforeInstallPromptEvent,
  disableWebPush,
  enableWebPush,
  isActualMobileDevice,
  isInstalledWebApp,
  isIosMobile,
  registerMobileServiceWorker,
  syncExistingWebPush,
} from "@/lib/webPush/client";

type PushState =
  | "unsupported"
  | "signed_out"
  | "default"
  | "denied"
  | "enabled"
  | "disabled"
  | "busy"
  | "error";

export interface MobilePwaState {
  install(): Promise<void>;
  installHelp: string | null;
  installed: boolean;
  isMobile: boolean;
  pushError: string | null;
  pushState: PushState;
  togglePush(): Promise<void>;
}

const MobilePwaContext = createContext<MobilePwaState | null>(null);

export function MobilePwaProvider({ children }: { children: ReactNode }) {
  const { session } = useSupabaseSession();
  const [isMobile, setIsMobile] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installHelp, setInstallHelp] = useState<string | null>(null);
  const [pushState, setPushState] = useState<PushState>("unsupported");
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const mobile = isActualMobileDevice();
    queueMicrotask(() => {
      if (!active) return;
      setIsMobile(mobile);
      setInstalled(isInstalledWebApp());
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
    if (!session) {
      publish("signed_out");
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

    void syncExistingWebPush(session.access_token)
      .then((synced) => {
        publish(synced ? "enabled" : "disabled");
      })
      .catch(() => {
        publish("error");
      });
    return () => {
      active = false;
    };
  }, [isMobile, session]);

  const install = useCallback(async () => {
    setInstallHelp(null);
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstallPrompt(null);
      return;
    }
    setInstallHelp(
      isIosMobile()
        ? "Safari의 공유 버튼을 누른 뒤 ‘홈 화면에 추가’를 선택해 주세요."
        : "Chrome 메뉴(⋮)에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택해 주세요.",
    );
  }, [installPrompt]);

  const togglePush = useCallback(async () => {
    if (!session || pushState === "busy") return;
    setPushState("busy");
    setPushError(null);
    try {
      if (Notification.permission === "granted" && pushState === "enabled") {
        await disableWebPush(session.access_token);
        setPushState("disabled");
      } else {
        await enableWebPush(session.access_token);
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
  }, [pushState, session]);

  const value = useMemo(
    () => ({
      install,
      installHelp,
      installed,
      isMobile,
      pushError,
      pushState,
      togglePush,
    }),
    [
      install,
      installHelp,
      installed,
      isMobile,
      pushError,
      pushState,
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
