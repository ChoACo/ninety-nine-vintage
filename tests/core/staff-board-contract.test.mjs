import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../../supabase/migrations/20260817164334_create_staff_notice_communication_board.sql", import.meta.url), "utf8");
const guideMigration = await readFile(new URL("../../supabase/migrations/20260824112459_replace_operator_product_registration_guides.sql", import.meta.url), "utf8");
const buyerGuideMigration = await readFile(new URL("../../supabase/migrations/20260824115918_add_buyer_purchase_guides.sql", import.meta.url), "utf8");
const buyerGuideDisclaimerMigration = await readFile(new URL("../../supabase/migrations/20260824121243_clarify_buyer_guide_test_data.sql", import.meta.url), "utf8");
const api = await readFile(new URL("../../src/app/api/admin/staff-board/route.ts", import.meta.url), "utf8");
const board = await readFile(new URL("../../src/components/admin/StaffBoard.tsx", import.meta.url), "utf8");
const guideNotices = await readFile(new URL("../../src/lib/notices/memberGuideNotices.ts", import.meta.url), "utf8");
const operatorLayout = await readFile(new URL("../../src/app/(admin)/admin/operator/layout.tsx", import.meta.url), "utf8");
const employeeLayout = await readFile(new URL("../../src/app/(admin)/admin/employee/layout.tsx", import.meta.url), "utf8");
const ownerLayout = await readFile(new URL("../../src/app/(admin)/admin/owner/layout.tsx", import.meta.url), "utf8");

test("staff board stays staff-only and notices stay owner-authored", () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.staff_board_posts from anon, authenticated/);
  assert.match(api, /authenticateStaffRequest\(request, true\)/);
  assert.match(api, /kind === "notice" && auth\.roleCode !== "owner"/);
});

test("all three administration workspaces expose the shared board", () => {
  assert.match(operatorLayout, /\/admin\/operator\/community/);
  assert.match(employeeLayout, /\/admin\/employee\/community/);
  assert.match(ownerLayout, /\/admin\/owner\/community/);
});

test("the old guide is replaced by separate mobile and PC product guides", () => {
  assert.match(guideMigration, /delete from public\.staff_board_posts/);
  assert.match(guideMigration, /\[모바일 필독\] 판매센터 상품 등록 방법/);
  assert.match(guideMigration, /\[PC 필독\] 판매센터 상품 등록 방법/);
  assert.match(guideMigration, /product-registration-mobile/);
  assert.match(guideMigration, /product-registration-pc/);
  assert.match(board, /GUIDE_IMAGE_CAPTIONS/);
  assert.match(board, /caption = GUIDE_IMAGE_CAPTIONS\[path\]/);
  assert.match(guideNotices, /product-registration-mobile/);
  assert.match(guideNotices, /product-registration-pc/);
});

test("buyer auction and archive guides include ordered screenshots and red callouts", () => {
  assert.match(buyerGuideMigration, /\[구매자 필독\] 라이브 옥션 입찰·결제·보관·배송 방법/);
  assert.match(buyerGuideMigration, /\[구매자 필독\] 아카이브숍 장바구니·결제·배송 방법/);
  assert.match(buyerGuideMigration, /guides\/buyer\/live-auction\/11-shipping-request-success\.png/);
  assert.match(buyerGuideMigration, /guides\/buyer\/archive-cart\/06-order-paid-shipping\.png/);
  assert.match(board, /path\.startsWith\("\/guides\/buyer\/"\)/);
  assert.match(board, /border-4 border-red-500/);
  assert.match(buyerGuideDisclaimerMigration, /개인정보와 실제 결제를 보호하기 위해 로컬 테스트 계정/);
  assert.match(buyerGuideDisclaimerMigration, /본인 화면에 표시된 상품명, 계좌, 금액, 결제 마감과 배송지/);
});
