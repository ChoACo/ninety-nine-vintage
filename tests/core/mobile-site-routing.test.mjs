import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isCustomerPagePath,
  isMobilePath,
  resolveAutomaticUiMode,
  toDesktopPath,
  toMobilePath,
} from "../../src/lib/uiMode.ts";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");
const requestHeaders = (values = {}) => new Headers(values);

test("mobile and tablet detection uses client hints before the user agent", () => {
  const iphone = requestHeaders({ "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile" });
  const ipad = requestHeaders({ "user-agent": "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)" });
  const androidTablet = requestHeaders({ "user-agent": "Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit" });
  const clientHintMobile = requestHeaders({ "sec-ch-ua-mobile": "?1", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });

  assert.equal(resolveAutomaticUiMode(iphone), "mobile");
  assert.equal(resolveAutomaticUiMode(ipad), "mobile");
  assert.equal(resolveAutomaticUiMode(androidTablet), "mobile");
  assert.equal(resolveAutomaticUiMode(clientHintMobile), "mobile");
});

test("desktop, unknown devices, and search bots stay on the PC site", () => {
  const desktop = requestHeaders({ "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140" });
  const bot = requestHeaders({ "sec-ch-ua-mobile": "?1", "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" });
  assert.equal(resolveAutomaticUiMode(desktop), "desktop");
  assert.equal(resolveAutomaticUiMode(requestHeaders()), "desktop");
  assert.equal(resolveAutomaticUiMode(bot), "desktop");
});

test("path conversion is reversible, loop-safe, and leaves excluded surfaces alone", () => {
  assert.equal(toMobilePath("/shop"), "/m/shop");
  assert.equal(toMobilePath("/m/shop"), "/m/shop");
  assert.equal(toMobilePath("/"), "/m/home");
  assert.equal(toDesktopPath("/m/shop"), "/shop");
  assert.equal(toDesktopPath("/m"), "/home");
  assert.equal(toDesktopPath("/m/checkout"), "/cart");
  assert.equal(toDesktopPath("/m/account/settings"), "/account");
  assert.equal(toDesktopPath("/m/account/orders"), "/account");
  assert.equal(toDesktopPath("/shop"), "/shop");
  assert.equal(isMobilePath("/m/auction/item"), true);

  for (const path of ["/api/products", "/_next/static/app.js", "/admin", "/webhook/portone", "/robots.txt", "/sitemap.xml", "/image.png"]) {
    assert.equal(isCustomerPagePath(path), false, `${path} must not auto-redirect`);
  }
  for (const path of ["/", "/home", "/shop", "/auction/item", "/m/shop", "/m/account/settings"]) {
    assert.equal(isCustomerPagePath(path), true, `${path} must participate in UI mode routing`);
  }
});

test("middleware enforces device routing, expires legacy choices, and keeps rollout controls", async () => {
  const [middleware, flags, footer, mobileHeader, mobileSettings, wrangler] = await Promise.all([
    source("src/middleware.ts"),
    source("src/lib/featureFlags.ts"),
    source("src/components/layout/PcFooter.tsx"),
    source("src/components/mobile/MobileSiteHeader.tsx"),
    source("src/app/(mobile)/m/account/settings/page.tsx"),
    source("wrangler.jsonc"),
  ]);

  assert.match(middleware, /MOBILE_SITE_ENABLED[\s\S]*MOBILE_AUTO_REDIRECT_ENABLED/);
  assert.match(middleware, /resolveAutomaticUiMode\(request\.headers\)/);
  assert.match(middleware, /const destination = request\.nextUrl\.clone\(\)/);
  assert.match(middleware, /destination\.pathname =/);
  assert.match(middleware, /NextResponse\.redirect\(destination, 307\)/);
  assert.match(middleware, /Vary", "Sec-CH-UA-Mobile, User-Agent"/);
  assert.match(middleware, /request\.cookies\.has\(LEGACY_UI_MODE_COOKIE\)/);
  assert.match(middleware, /response\.cookies\.delete\(LEGACY_UI_MODE_COOKIE\)/);
  assert.doesNotMatch(middleware, /request\.cookies\.get/);
  assert.match(flags, /MOBILE_SITE_ENABLED[\s\S]*!== "false"/);
  assert.match(flags, /MOBILE_AUTO_REDIRECT_ENABLED[\s\S]*!== "false"/);
  for (const surface of [footer, mobileHeader, mobileSettings]) {
    assert.doesNotMatch(surface, /UiModeSwitcher|ui-mode/);
  }
  assert.match(wrangler, /"run_worker_first"[\s\S]*"\/\*"[\s\S]*"!\/_next\/\*"/);
  await assert.rejects(source("src/app/api/ui-mode/route.ts"), { code: "ENOENT" });
  await assert.rejects(source("src/components/mobile/UiModeSwitcher.tsx"), { code: "ENOENT" });
});
