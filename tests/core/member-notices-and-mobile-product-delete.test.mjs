import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

const [
  publicApi,
  memberApi,
  noticeIds,
  imageDimensions,
  board,
  desktopPage,
  mobilePage,
  mobileHeader,
  settings,
  productConsole,
] = await Promise.all([
  source("src/app/api/notices/route.ts"),
  source("src/app/api/account/notices/route.ts"),
  source("src/lib/notices/memberGuideNotices.ts"),
  source("src/lib/notices/guideImageDimensions.ts"),
  source("src/components/notices/MemberNoticeBoard.tsx"),
  source("src/app/(shop)/notices/page.tsx"),
  source("src/app/(mobile)/m/notices/page.tsx"),
  source("src/components/mobile/MobileSiteHeader.tsx"),
  source("src/components/settings/SiteSettingsPage.tsx"),
  source("src/components/admin/operator/OperatorProductsConsole.tsx"),
]);

test("public notices preserve the staff board allow-list and expose only four guide posts", () => {
  assert.match(publicApi, /createSupabaseServerClients\(\)/);
  assert.doesNotMatch(publicApi, /authenticateMemberCommerceRequest/);
  assert.match(publicApi, /\.eq\("kind", "notice"\)/);
  assert.match(publicApi, /\.in\("id", \[\.\.\.MEMBER_GUIDE_NOTICE_IDS\]\)/);
  assert.doesNotMatch(publicApi, /staff_board_comments/);
  assert.match(memberApi, /authenticateMemberCommerceRequest\(request\)/);
  assert.equal(
    [...noticeIds.matchAll(/99000000-0000-4000-8000-00000000000[2-5]/g)]
      .map(([id]) => id)
      .filter((id, index, all) => all.indexOf(id) === index).length,
    4,
  );
});

test("desktop and mobile notice pages are public and remain discoverable", () => {
  assert.doesNotMatch(desktopPage, /MemberAccountBoundary/);
  assert.doesNotMatch(mobilePage, /MemberAccountBoundary/);
  assert.match(desktopPage, /<MemberNoticeBoard \/>/);
  assert.match(mobilePage, /<MemberNoticeBoard \/>/);
  assert.match(mobileHeader, /공지사항 · 이용 가이드/);
  assert.doesNotMatch(
    mobileHeader.match(/const MEMBER_ONLY_MOBILE_HREFS[\s\S]*?\]\);/)?.[0] ?? "",
    /\/m\/notices/,
  );
  assert.match(settings, /\$\{basePath\}\/notices/);
});

test("member guide layout is mobile-safe, read-only, and uses intrinsic lightbox images", () => {
  assert.match(board, /max-w-6xl/);
  assert.match(board, /fetch\("\/api\/notices"/);
  assert.doesNotMatch(board, /if \(!token\) return/);
  assert.match(board, /구매자 가이드/);
  assert.match(board, /판매자 가이드/);
  assert.match(board, /공지 카테고리/);
  assert.match(board, /목록으로/);
  assert.match(board, /lg:grid-cols-\[320px_minmax\(0,1fr\)\]/);
  assert.match(board, /rounded-2xl border border-line bg-surface p-2/);
  assert.doesNotMatch(board, /border-4 border-red-500/);
  assert.match(board, /PremiumDialog/);
  assert.match(board, /Step \{index \+ 1\}/);
  assert.match(board, /mx-auto h-auto w-full max-w-lg object-contain/);
  assert.doesNotMatch(board, /height=\{900\}[\s\S]{0,160}width=\{1440\}/);
  assert.match(imageDimensions, /01-select-product\.png[\s\S]{0,40}width: 381, height: 824/);
  assert.match(imageDimensions, /02-new-product-menu\.png[\s\S]{0,40}width: 1440, height: 900/);
  assert.doesNotMatch(board, /create_comment|답변 등록|글쓰기/);
});

test("mobile operator product cards include a touch-safe destructive delete action", () => {
  assert.match(productConsole, /md:hidden/);
  assert.match(productConsole, /aria-label=\{`\$\{product\.title\} 삭제`\}/);
  assert.match(productConsole, /min-h-11[\s\S]{0,300}Trash2[\s\S]{0,80}삭제/);
  assert.match(productConsole, /method: "DELETE"/);
  assert.match(productConsole, /expectedUpdatedAt: product\.updated_at/);
});
