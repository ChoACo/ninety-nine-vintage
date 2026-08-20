import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("buyer account navigation contains only account and shopping workflows", async () => {
  const grid = await source(
    "src/components/features/account/MobileAccountTaskGrid.tsx",
  );

  for (const label of [
    "주문·결제",
    "보관·배송",
    "취소·환불",
    "채팅",
  ]) {
    assert.match(grid, new RegExp(`"${label}"`));
  }
  assert.match(grid, /배송 신청/);
  assert.match(grid, /배송 현황/);
  assert.match(grid, /문의 채팅/);
  assert.doesNotMatch(grid, /알림 설정|계정·화면 설정|\/account\/settings/);
});

test("staff navigation follows each role's core work sequence", async () => {
  const [operatorLayout, employeeLayout, ownerLayout, operatorDashboard] =
    await Promise.all([
      source("src/app/(admin)/admin/operator/layout.tsx"),
      source("src/app/(admin)/admin/employee/layout.tsx"),
      source("src/app/(admin)/admin/owner/layout.tsx"),
      source("src/components/admin/operator/OperatorConsole.tsx"),
    ]);

  for (const label of [
    "오늘 할 일",
    "판매 중 상품",
    "상품 등록",
    "판매 내역",
    "매장 설정",
    "공지",
  ]) {
    assert.match(operatorLayout, new RegExp(`label: "${label}"`));
  }
  for (const label of ["오늘의 작업", "상품 준비", "포장·송장", "문의"]) {
    assert.match(employeeLayout, new RegExp(`"${label}"`));
  }
  for (const label of [
    "입금 확인",
    "환불·긴급",
    "매장·직원",
    "정산",
    "시스템",
  ]) {
    assert.match(ownerLayout, new RegExp(`label: "${label}"`));
  }
  assert.match(operatorDashboard, /오늘 \/ 업무 목록/);
});

test("staff keeps member account access and auction pages keep the cart control", async () => {
  const [mobileHeader, mobileBottomNav, toolbar] = await Promise.all([
    source("src/components/mobile/MobileSiteHeader.tsx"),
    source("src/components/mobile/MobileSiteBottomNav.tsx"),
    source("src/components/features/commerce/CommerceToolbar.tsx"),
  ]);

  assert.match(mobileHeader, /\[\["업무", roleNavigation\.centerHref\]/);
  assert.match(mobileHeader, /\["MY", "\/m\/account"\]/);
  assert.doesNotMatch(mobileBottomNav, /access\.roleCode|roleNavigation/);
  assert.match(mobileBottomNav, /\["MY", "\/m\/account", UserRound\]/);
  assert.match(toolbar, /aria-label="장바구니"/);
  assert.match(toolbar, /aria-label="설정"[\s\S]*href="\/settings"/);
  assert.doesNotMatch(toolbar, /aria-label="입찰 현황"/);
  assert.doesNotMatch(toolbar, /auctionContext/);
});
