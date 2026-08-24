import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("header logout surfaces use the shared browser-session cleanup", async () => {
  const files = await Promise.all([
    source("src/components/layout/UserMenuDropdown.tsx"),
    source("src/components/features/mypage/ProfileHeader.tsx"),
  ]);
  for (const file of files) {
    assert.match(file, /logoutBrowserSession\(/u);
    assert.doesNotMatch(file, /auth\.signOut\(/u);
  }
});

test("notification read mutations rollback and refresh after failure", async () => {
  const file = await source(
    "src/components/features/notifications/NotificationCenterButton.tsx",
  );
  assert.match(file, /previousReadAt/u);
  assert.match(file, /clientErrorFromResponse/u);
  assert.match(file, /await loadNotifications\(\)\.catch/u);
  assert.match(file, /notification-read-all/u);
  assert.doesNotMatch(file, /\.catch\(\(\) => undefined\)/u);
});

test("client error reporter retains API context and throttles duplicate toasts", async () => {
  const file = await source("src/lib/clientErrors.ts");
  for (const field of ["code", "error", "message", "stage"]) {
    assert.match(file, new RegExp(`\\b${field}\\b`, "u"));
  }
  assert.match(file, /dedupeMs = 12_000/u);
  assert.match(file, /visibility === "development"/u);
  assert.match(file, /useToastStore\.getState\(\)\.pushToast/u);
});

test("audited background refresh paths expose retryable failures", async () => {
  const files = await Promise.all([
    source("src/hooks/usePlatformConfig.ts"),
    source("src/components/features/inquiry/InquiryForm.tsx"),
    source("src/components/features/auction/ActiveBidProducts.tsx"),
    source("src/components/features/chat/ChatPanel.tsx"),
    source("src/components/admin/operator/OperatorChatConsole.tsx"),
    source("src/components/features/mypage/ProfileHeader.tsx"),
  ]);
  for (const file of files) {
    assert.match(file, /reportClientError/u);
    assert.doesNotMatch(file, /\.catch\(\(\) => undefined\)/u);
  }
  for (const file of files.slice(1)) {
    assert.match(file, /다시 불러오기/u);
  }
});

test("root, commerce, mobile, and admin error boundaries are present", async () => {
  const [global, admin, shop, mobile] = await Promise.all([
    source("src/app/global-error.tsx"),
    source("src/app/(admin)/admin/error.tsx"),
    source("src/app/(shop)/error.tsx"),
    source("src/app/(mobile)/m/error.tsx"),
  ]);
  assert.match(global, /<html lang="ko">/u);
  assert.match(global, /<body/u);
  for (const boundary of [admin, shop, mobile]) {
    assert.match(boundary, /RouteErrorFallback/u);
  }
});

test("previously disconnected interface controls have real semantics", async () => {
  const [intro, account, products] = await Promise.all([
    source("src/components/features/auction/live/LiveAuctionIntro.tsx"),
    source("src/components/features/account/AccountDashboard.tsx"),
    source("src/components/admin/operator/OperatorProductsConsole.tsx"),
  ]);
  assert.match(intro, /href=\{`\$\{basePath\}\/my\?tab=settings`\}/u);
  assert.match(intro, /경매 오픈 알림 설정/u);
  assert.match(account, /송장번호를 복사했습니다/u);
  assert.match(account, /송장번호를 복사하지 못했습니다/u);
  assert.match(products, /role="status"/u);
});
