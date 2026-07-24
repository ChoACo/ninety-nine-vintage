"use client";

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

type NavigatorWithMobileHints = Navigator & {
  standalone?: boolean;
  userAgentData?: { mobile?: boolean };
};

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
  const registration = await registerMobileServiceWorker();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "브라우저 설정에서 알림 권한을 허용해 주세요."
        : "알림 권한을 허용해야 새 소식을 받을 수 있습니다.",
    );
  }

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
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return subscription;
}

export async function syncExistingWebPush(accessToken: string) {
  if (
    !("serviceWorker" in navigator) ||
    !("Notification" in window) ||
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
    body: JSON.stringify(subscription.toJSON()),
  });
  return response.ok;
}

export async function disableWebPush(accessToken: string) {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  await fetch("/api/push/subscription", {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => false);
}
