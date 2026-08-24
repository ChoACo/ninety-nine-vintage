import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

const [
  api,
  noticeIds,
  board,
  desktopPage,
  mobilePage,
  mobileHeader,
  settings,
  productConsole,
] = await Promise.all([
  source("src/app/api/account/notices/route.ts"),
  source("src/lib/notices/memberGuideNotices.ts"),
  source("src/components/notices/MemberNoticeBoard.tsx"),
  source("src/app/(shop)/notices/page.tsx"),
  source("src/app/(mobile)/m/notices/page.tsx"),
  source("src/components/mobile/MobileSiteHeader.tsx"),
  source("src/components/settings/SiteSettingsPage.tsx"),
  source("src/components/admin/operator/OperatorProductsConsole.tsx"),
]);

test("member notices preserve the staff board boundary and expose only four guide posts", () => {
  assert.match(api, /authenticateMemberCommerceRequest\(request\)/);
  assert.match(api, /\.eq\("kind", "notice"\)/);
  assert.match(api, /\.in\("id", \[\.\.\.MEMBER_GUIDE_NOTICE_IDS\]\)/);
  assert.doesNotMatch(api, /staff_board_comments/);
  assert.equal(
    [...noticeIds.matchAll(/99000000-0000-4000-8000-00000000000[2-5]/g)]
      .map(([id]) => id)
      .filter((id, index, all) => all.indexOf(id) === index).length,
    4,
  );
});

test("desktop and mobile notice pages require a member session and remain discoverable", () => {
  assert.match(desktopPage, /<MemberAccountBoundary returnTo="\/notices">/);
  assert.match(mobilePage, /<MemberAccountBoundary basePath="\/m" returnTo="\/m\/notices">/);
  assert.match(mobileHeader, /공지사항 · 이용 가이드/);
  assert.match(settings, /\$\{basePath\}\/notices/);
});

test("member guide layout is mobile-safe, read-only, and keeps red screenshot callouts", () => {
  assert.match(board, /max-w-6xl/);
  assert.match(board, /overflow-x-auto overscroll-contain/);
  assert.match(board, /border-4 border-red-500/);
  assert.doesNotMatch(board, /create_comment|답변 등록|글쓰기/);
});

test("mobile operator product cards include a touch-safe destructive delete action", () => {
  assert.match(productConsole, /md:hidden/);
  assert.match(productConsole, /aria-label=\{`\$\{product\.title\} 삭제`\}/);
  assert.match(productConsole, /min-h-11[\s\S]{0,300}Trash2[\s\S]{0,80}삭제/);
  assert.match(productConsole, /method: "DELETE"/);
  assert.match(productConsole, /expectedUpdatedAt: product\.updated_at/);
});
