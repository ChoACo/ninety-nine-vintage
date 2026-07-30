import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const rootUrl = new URL("../../", import.meta.url);

async function loadChromeLaunchModule() {
  const source = await readFile(
    new URL("src/lib/pwa/chromeLaunch.ts", rootUrl),
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
}

test("KakaoTalk and other mobile browsers fall back to opening Chrome", async () => {
  const { detectInstallBrowser, getInstallFallbackMode } =
    await loadChromeLaunchModule();
  const androidKakao = detectInstallBrowser(
    "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 KAKAOTALK 25.6.0",
  );
  const androidSamsung = detectInstallBrowser(
    "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0 SamsungBrowser/28.0 Mobile Safari/537.36",
  );
  const iosKakao = detectInstallBrowser(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 KAKAOTALK 25.6.0",
  );

  assert.deepEqual(androidKakao, {
    browser: "in_app",
    inAppBrowser: true,
    platform: "android",
  });
  assert.equal(getInstallFallbackMode(androidKakao), "open_chrome");
  assert.equal(getInstallFallbackMode(androidSamsung), "open_chrome");
  assert.equal(getInstallFallbackMode(iosKakao), "open_chrome");
});

test("Chrome stays in Chrome so its native PWA install flow can be used", async () => {
  const { detectInstallBrowser, getInstallFallbackMode } =
    await loadChromeLaunchModule();
  const androidChrome = detectInstallBrowser(
    "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36",
  );
  const iosChrome = detectInstallBrowser(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 CriOS/140.0 Mobile/15E148 Safari/604.1",
  );

  assert.equal(androidChrome.browser, "chrome");
  assert.equal(iosChrome.browser, "chrome");
  assert.equal(getInstallFallbackMode(androidChrome), "manual");
  assert.equal(getInstallFallbackMode(iosChrome), "manual");
});

test("Android Chrome intent preserves the page and has an official store fallback", async () => {
  const {
    ANDROID_CHROME_STORE_URL,
    buildAndroidChromeIntent,
  } = await loadChromeLaunchModule();
  const target =
    "https://www.ninety-nine-vintage.store/m/product/abc?from=kakao#bid";
  const intent = buildAndroidChromeIntent(target);

  assert.ok(intent);
  assert.match(
    intent,
    /^intent:\/\/www\.ninety-nine-vintage\.store\/m\/product\/abc\?from=kakao#bid#Intent;/,
  );
  assert.match(intent, /scheme=https;package=com\.android\.chrome;/);
  assert.match(
    intent,
    new RegExp(
      `S\\.browser_fallback_url=${encodeURIComponent(
        ANDROID_CHROME_STORE_URL,
      )};end$`,
    ),
  );
});

test("iOS Chrome URLs preserve HTTPS paths and unsafe targets are rejected", async () => {
  const { buildAndroidChromeIntent, buildIosChromeUrl } =
    await loadChromeLaunchModule();

  assert.equal(
    buildIosChromeUrl(
      "https://www.ninety-nine-vintage.store/m/account/settings?from=kakao#install",
    ),
    "googlechromes://www.ninety-nine-vintage.store/m/account/settings?from=kakao#install",
  );
  assert.equal(buildIosChromeUrl("javascript:alert(1)"), null);
  assert.equal(buildAndroidChromeIntent("file:///etc/passwd"), null);
});
