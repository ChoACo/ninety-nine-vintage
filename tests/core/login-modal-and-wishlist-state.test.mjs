import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("intercepted login dismissal and guest browsing preserve the underlying page", async () => {
  const [intercepted, prompt, guestAction, authStatus, modalShell] = await Promise.all([
    source("src/app/(shop)/@modal/(.)account/login/page.tsx"),
    source("src/components/features/account/LoginPrompt.tsx"),
    source("src/components/features/account/GuestBrowseAction.tsx"),
    source("src/components/layout/AuthStatus.tsx"),
    source("src/components/layout/ModalShell.tsx"),
  ]);
  assert.match(intercepted, /<LoginPrompt dismissToPrevious/);
  assert.match(prompt, /dismissToPrevious=\{dismissToPrevious\}/);
  assert.match(prompt, /basePath=\{surface === "mobile" \? "\/m" : ""\}/);
  assert.match(guestAction, /onClick=\{\(\) => router\.back\(\)\}/);
  assert.match(guestAction, /href=\{`\$\{basePath\}\/home`\}/);
  assert.match(modalShell, /event\.target === event\.currentTarget && close\(\)/);
  assert.match(modalShell, /\(\) => router\.back\(\)/);
  assert.match(authStatus, /window\.location\.pathname/);
  assert.match(authStatus, /window\.location\.search/);
  assert.match(authStatus, /window\.location\.hash/);
});

test("wishlist empty copy distinguishes session and loading states", async () => {
  const dashboard = await source(
    "src/components/features/account/AccountDashboard.tsx",
  );
  assert.match(dashboard, /로그인 상태를 확인하고 있습니다\./);
  assert.match(dashboard, /찜한 상품을 불러오고 있습니다\./);
  assert.match(dashboard, /찜한 상품이 없습니다\./);
  assert.match(dashboard, /!token[\s\S]*로그인 후 찜한 상품이 표시됩니다\./);
});

test("member account pages redirect guests before rendering private dashboards", async () => {
  const [boundary, desktopAccount, mobileAccount, mobileSection, settings] =
    await Promise.all([
      source("src/components/features/account/MemberAccountBoundary.tsx"),
      source("src/app/(shop)/account/page.tsx"),
      source("src/app/(mobile)/m/account/page.tsx"),
      source("src/app/(mobile)/m/account/[section]/page.tsx"),
      source("src/app/(mobile)/m/account/settings/page.tsx"),
    ]);
  assert.match(boundary, /if \(!loading && !session\)/);
  assert.match(boundary, /router\.replace/);
  assert.match(boundary, /account\/login\?next=/);
  assert.match(boundary, /if \(loading \|\| !session\)/);
  assert.match(desktopAccount, /<MemberAccountBoundary>/);
  for (const mobilePage of [mobileAccount, mobileSection, settings]) {
    assert.match(mobilePage, /<MemberAccountBoundary basePath="\/m"/);
  }
});
