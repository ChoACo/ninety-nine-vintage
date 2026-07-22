import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isCustomerPagePath,
  isMobilePath,
  resolveUiMode,
  toDesktopPath,
  toMobilePath,
} from "../../src/lib/uiMode.ts";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");
const requestHeaders = (values = {}) => new Headers(values);

test("mobile and tablet detection keeps cookie choice above client hints and user agent", () => {
  const iphone = requestHeaders({ "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile" });
  const ipad = requestHeaders({ "user-agent": "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)" });
  const androidTablet = requestHeaders({ "user-agent": "Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit" });
  const clientHintMobile = requestHeaders({ "sec-ch-ua-mobile": "?1", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });

  assert.equal(resolveUiMode(iphone, null), "mobile");
  assert.equal(resolveUiMode(ipad, null), "mobile");
  assert.equal(resolveUiMode(androidTablet, null), "mobile");
  assert.equal(resolveUiMode(clientHintMobile, null), "mobile");
  assert.equal(resolveUiMode(iphone, "desktop"), "desktop");
  assert.equal(resolveUiMode(requestHeaders(), "mobile"), "mobile");
});

test("desktop, unknown devices, and search bots stay on the PC site", () => {
  const desktop = requestHeaders({ "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140" });
  const bot = requestHeaders({ "sec-ch-ua-mobile": "?1", "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" });
  assert.equal(resolveUiMode(desktop, null), "desktop");
  assert.equal(resolveUiMode(requestHeaders(), null), "desktop");
  assert.equal(resolveUiMode(bot, null), "desktop");
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

test("middleware and UI mode API preserve local destinations and rollout controls", async () => {
  const [middleware, api, flags] = await Promise.all([
    source("src/middleware.ts"),
    source("src/app/api/ui-mode/route.ts"),
    source("src/lib/featureFlags.ts"),
  ]);

  assert.match(middleware, /MOBILE_SITE_ENABLED[\s\S]*MOBILE_AUTO_REDIRECT_ENABLED/);
  assert.match(middleware, /const destination = request\.nextUrl\.clone\(\)/);
  assert.match(middleware, /destination\.pathname =/);
  assert.match(middleware, /NextResponse\.redirect\(destination, 307\)/);
  assert.match(middleware, /Vary", "Cookie, Sec-CH-UA-Mobile, User-Agent"/);
  assert.match(api, /safeSameOriginReturnTo/);
  assert.match(api, /returnUrl\.search/);
  assert.match(api, /returnUrl\.hash/);
  assert.match(api, /60 \* 60 \* 24 \* 180/);
  assert.match(api, /sameSite: "lax"/);
  assert.match(api, /response\.cookies\.delete\(UI_MODE_COOKIE\)/);
  assert.match(flags, /MOBILE_SITE_ENABLED[\s\S]*!== "false"/);
  assert.match(flags, /MOBILE_AUTO_REDIRECT_ENABLED[\s\S]*=== "true"/);
});
