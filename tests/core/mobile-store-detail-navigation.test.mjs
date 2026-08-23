import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("store detail header provides an in-app back action with a safe list fallback", async () => {
  const tabs = await source("src/components/features/catalog/StoreMallTabs.tsx");
  assert.match(tabs, /useRouter\(\)/);
  assert.match(tabs, /router\.back\(\)/);
  assert.match(tabs, /router\.push\(fallbackHref\)/);
  assert.match(tabs, /aria-label="이전 페이지"/);
  assert.match(tabs, /min-h-\[44px\][\s\S]*min-w-\[44px\]/);
});

test("store detail uses the real banner fields and a curated visual fallback", async () => {
  const experience = await source(
    "src/components/features/catalog/StoreMallExperience.tsx",
  );
  assert.match(
    experience,
    /store\.bannerUrl\?\.trim\(\) \|\| store\.mallImage\?\.trim\(\)/,
  );
  assert.match(experience, /NINETY-NINE VINTAGE STORE/);
  assert.doesNotMatch(experience, /센터 배너 이미지를 등록하면/);
});

test("storage cards link the seller touch target to the existing center route", async () => {
  const dashboard = await source(
    "src/components/features/account/AccountDashboard.tsx",
  );
  assert.match(
    dashboard,
    /href=\{`\$\{basePath\}\/centers\/\$\{encodeURIComponent\(item\.originStoreId\)\}`\}/,
  );
  assert.match(dashboard, /hover:underline active:opacity-80/);
  assert.match(dashboard, /min-h-11/);
});
