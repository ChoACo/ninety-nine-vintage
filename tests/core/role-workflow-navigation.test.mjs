import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("buyer account navigation is grouped into five core workflows", async () => {
  const grid = await source(
    "src/components/features/account/MobileAccountTaskGrid.tsx",
  );

  for (const label of [
    "주문·결제",
    "보관·배송",
    "취소·환불",
    "채팅·알림",
    "계정",
  ]) {
    assert.match(grid, new RegExp(`"${label}"`));
  }
  assert.match(grid, /배송 신청·현황/);
  assert.match(grid, /문의 채팅/);
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
    "판매",
    "결제 상태",
    "준비·배송",
    "문의",
    "매출·정산",
    "매장 설정",
  ]) {
    assert.match(operatorLayout, new RegExp(`label: "${label}"`));
  }
  for (const label of ["오늘의 작업", "입출고·보관", "소포·송장", "문의", "내 정보"]) {
    assert.match(employeeLayout, new RegExp(`"${label}"`));
  }
  for (const label of [
    "입금 확인",
    "긴급 요청",
    "매장·권한",
    "정산",
    "정책·보안",
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

  for (const sourceText of [mobileHeader, mobileBottomNav]) {
    assert.match(sourceText, /access\.roleCode === "operator"/);
    assert.match(sourceText, /access\.roleCode === "employee"/);
    assert.match(sourceText, /"내 정보", "\/m\/account"/);
  }
  assert.match(toolbar, /aria-label="장바구니"/);
  assert.doesNotMatch(toolbar, /aria-label="입찰 현황"/);
  assert.doesNotMatch(toolbar, /auctionContext/);
});
