export const ANDROID_CHROME_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.android.chrome";
export const IOS_CHROME_STORE_URL =
  "https://apps.apple.com/app/google-chrome/id535886823";

export type MobilePlatform = "android" | "ios" | "other";
export type InstallFallbackMode = "open_chrome" | "manual";

export interface InstallBrowserContext {
  browser: "chrome" | "in_app" | "other";
  inAppBrowser: boolean;
  platform: MobilePlatform;
}

const IN_APP_BROWSER_PATTERN =
  /KAKAOTALK|KAKAOSTORY|NAVER|DAUMAPPS|FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|;\s*wv\)|\bwv\b|WebView/i;

export function detectInstallBrowser(
  userAgent: string,
  platform = "",
  maxTouchPoints = 0,
): InstallBrowserContext {
  const android = /Android/i.test(userAgent);
  const ios =
    /iPhone|iPad|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1);
  const inAppBrowser = IN_APP_BROWSER_PATTERN.test(userAgent);
  const chrome =
    !inAppBrowser &&
    (/CriOS\//i.test(userAgent) ||
      (/Chrome\//i.test(userAgent) &&
        !/EdgA?\/|OPR\/|SamsungBrowser\/|DuckDuckGo\//i.test(userAgent)));

  return {
    browser: chrome ? "chrome" : inAppBrowser ? "in_app" : "other",
    inAppBrowser,
    platform: android ? "android" : ios ? "ios" : "other",
  };
}

export function getInstallFallbackMode(
  context: InstallBrowserContext,
): InstallFallbackMode {
  return context.platform !== "other" && context.browser !== "chrome"
    ? "open_chrome"
    : "manual";
}

function parseWebUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

export function buildAndroidChromeIntent(
  targetUrl: string,
  fallbackUrl = ANDROID_CHROME_STORE_URL,
) {
  const target = parseWebUrl(targetUrl);
  const fallback = parseWebUrl(fallbackUrl);
  if (!target || !fallback) return null;

  const targetWithoutScheme = target.href.slice(
    `${target.protocol}//`.length,
  );
  return `intent://${targetWithoutScheme}#Intent;scheme=${target.protocol.slice(
    0,
    -1,
  )};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(
    fallback.href,
  )};end`;
}

export function buildIosChromeUrl(targetUrl: string) {
  const target = parseWebUrl(targetUrl);
  if (!target) return null;

  const chromeScheme =
    target.protocol === "https:" ? "googlechromes:" : "googlechrome:";
  return `${chromeScheme}${target.href.slice(target.protocol.length)}`;
}
