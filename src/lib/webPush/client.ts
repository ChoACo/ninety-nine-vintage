"use client";

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

type NavigatorWithMobileHints = Navigator & {
  standalone?: boolean;
  userAgentData?: { mobile?: boolean };
};

export type WebPushClientMode = "browser" | "standalone";

export function isActualMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const mobileNavigator = navigator as NavigatorWithMobileHints;
  if (typeof mobileNavigator.userAgentData?.mobile === "boolean") {
    return mobileNavigator.userAgentData.mobile;
  }
  return (
    /Android|iPhone|iPod|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isInstalledWebApp() {
  if (typeof window === "undefined") return false;
  const mobileNavigator = navigator as NavigatorWithMobileHints;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    mobileNavigator.standalone === true
  );
}

export function isIosMobile() {
  if (typeof navigator === "undefined") return false;
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function getWebPushClientMode(): WebPushClientMode | null {
  if (
    typeof window === "undefined" ||
    !isActualMobileDevice() ||
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return null;
  }
  if (isInstalledWebApp()) return "standalone";
  return isIosMobile() ? null : "browser";
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

async function readApiError(response: Response) {
  const body = (await response.json().catch(() => null)) as
    | { message?: string }
    | null;
  return body?.message || "알림 설정을 완료하지 못했습니다.";
}

export async function registerMobileServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("이 브라우저는 앱 알림을 지원하지 않습니다.");
  }
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export async function enableWebPush(accessToken: string) {
  const clientMode = getWebPushClientMode();
  if (!clientMode) {
    throw new Error(
      isIosMobile()
        ? "iPhone·iPad에서는 Safari의 ‘홈 화면에 추가’ 후 설치한 앱에서 알림을 켜 주세요."
        : "현재 모바일 브라우저는 시스템 알림을 지원하지 않습니다.",
    );
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "브라우저 설정에서 알림 권한을 허용해 주세요."
        : "알림 권한을 허용해야 새 소식을 받을 수 있습니다.",
    );
  }
  const registration = await registerMobileServiceWorker();

  const keyResponse = await fetch("/api/push/subscription", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!keyResponse.ok) throw new Error(await readApiError(keyResponse));
  const keyBody = (await keyResponse.json()) as { publicKey?: string };
  if (!keyBody.publicKey) throw new Error("알림 공개 키가 설정되지 않았습니다.");

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyBody.publicKey),
    });
  }

  const response = await fetch("/api/push/subscription", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...subscription.toJSON(),
      clientMode,
    }),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return subscription;
}

export async function syncExistingWebPush(accessToken: string) {
  const clientMode = getWebPushClientMode();
  if (
    !clientMode ||
    Notification.permission !== "granted"
  ) {
    return false;
  }
  const registration = await registerMobileServiceWorker();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;
  const response = await fetch("/api/push/subscription", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...subscription.toJSON(),
      clientMode,
    }),
  });
  return response.ok;
}

export async function disableWebPush(accessToken: string) {
  if (!("serviceWorker" in navigator)) return;
  const registration = await Promise.race([
    navigator.serviceWorker.getRegistration("/"),
    new Promise<undefined>((resolve) => window.setTimeout(resolve, 1_000)),
  ]);
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  await fetch("/api/push/subscription", {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
    signal: AbortSignal.timeout(2_000),
  }).catch(() => undefined);
  await Promise.race([
    subscription.unsubscribe().catch(() => false),
    new Promise<false>((resolve) => window.setTimeout(() => resolve(false), 1_000)),
  ]);
}

export async function showTestWebPushNotification() {
  const clientMode = getWebPushClientMode();
  if (!clientMode || Notification.permission !== "granted") {
    throw new Error("먼저 모바일 시스템 알림을 켜 주세요.");
  }
  const registration = await registerMobileServiceWorker();
  const options: NotificationOptions & {
    renotify?: boolean;
    vibrate?: number[];
  } = {
    body: "상태창에 이 알림이 보이면 모바일 알림 설정이 정상입니다.",
    icon: "/pwa-icon-192.png",
    badge: "/pwa-icon-192.png",
    tag: "ninety-nine-test",
    renotify: true,
    vibrate: [200, 100, 200],
    data: { url: "/m/account/settings" },
  };
  await registration.showNotification("NINETY-NINE 시험 알림", options);
}
