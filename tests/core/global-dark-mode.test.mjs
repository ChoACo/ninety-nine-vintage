import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

function channelToLinear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance([red, green, blue]) {
  return 0.2126 * channelToLinear(red) + 0.7152 * channelToLinear(green) + 0.0722 * channelToLinear(blue);
}

function contrast(first, second) {
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

test("global theme initializes before hydration and persists an accessible user choice", async () => {
  const [layout, toggle, desktopHeader, mobileHeader, adminLayout] = await Promise.all([
    source("src/app/layout.tsx"),
    source("src/components/layout/ThemeToggle.tsx"),
    source("src/components/layout/PcHeader.tsx"),
    source("src/components/mobile/MobileSiteHeader.tsx"),
    source("src/app/(admin)/admin/layout.tsx"),
  ]);

  assert.match(layout, /prefers-color-scheme: dark/);
  assert.match(layout, /localStorage\.getItem\(storageKey\)/);
  assert.match(layout, /root\.dataset\.theme = theme/);
  assert.match(layout, /suppressHydrationWarning/);
  assert.match(layout, /name="color-scheme"/);
  assert.match(layout, /dangerouslySetInnerHTML/);
  assert.match(toggle, /localStorage\.setItem\(STORAGE_KEY, theme\)/);
  assert.match(toggle, /aria-label=\{label\}/);
  assert.match(toggle, /aria-pressed=\{dark\}/);
  assert.match(desktopHeader, /<ThemeToggle/);
  assert.match(mobileHeader, /<ThemeToggle[^>]*showLabel/);
  assert.match(adminLayout, /<ThemeToggle/);
});

test("dark palette uses layered non-black surfaces with readable contrast", async () => {
  const css = await source("src/app/globals.css");
  const tailwind = await source("tailwind.config.ts");
  const darkBlock = css.match(/html\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(css, /:root\s*\{/);
  assert.match(css, /color-scheme: dark/);
  assert.match(darkBlock, /--theme-paper:\s*21 24 28/);
  assert.match(darkBlock, /--theme-surface:\s*31 36 42/);
  assert.match(darkBlock, /--theme-line:\s*64 71 80/);
  assert.match(css, /--store-card-1:\s*#554b40/);
  assert.match(css, /\.theme-invariant-dark/);
  assert.ok(contrast([21, 24, 28], [241, 236, 226]) >= 7, "paper and ink must meet enhanced contrast");
  assert.ok(contrast([21, 24, 28], [174, 181, 191]) >= 4.5, "muted text must remain readable");
  assert.ok(contrast([31, 36, 42], [241, 236, 226]) >= 7, "surface and ink must meet enhanced contrast");
  for (const token of ["ink", "paper", "line", "muted", "surface", "inverse"]) {
    assert.match(tailwind, new RegExp(`rgb\\(var\\(--theme-${token}\\) \\/ <alpha-value>\\)`));
  }
});

test("legacy fixed light surfaces and status notices have dark palette coverage", async () => {
  const [css, middleware, home, storePage, gallery, ticker] = await Promise.all([
    source("src/app/globals.css"),
    source("src/middleware.ts"),
    source("src/app/(shop)/home/page.tsx"),
    source("src/app/(shop)/stores/[slug]/page.tsx"),
    source("src/components/features/auction/AuctionGalleryModal.tsx"),
    source("src/components/layout/LiveTickerBar.tsx"),
  ]);

  for (const variable of [
    "color-white", "color-zinc-50", "color-zinc-950",
    "color-red-50", "color-red-800", "color-rose-50", "color-rose-800",
    "color-amber-50", "color-amber-900", "color-emerald-50", "color-emerald-800",
    "color-sky-50", "color-sky-900", "color-blue-50", "color-blue-900",
  ]) {
    assert.match(css, new RegExp(`--${variable}:`));
  }
  assert.doesNotMatch(home, /\["#c7b9a5", "#9fa9a2", "#b8a7a1"\]/);
  assert.doesNotMatch(home, /var\(--store-card-/);
  assert.match(storePage, /bg-\[var\(--store-card-1\)\]/);
  assert.match(gallery, /theme-invariant-dark/);
  assert.match(ticker, /theme-invariant-dark/);
  assert.match(middleware, /@media\(prefers-color-scheme:dark\)/);
});
