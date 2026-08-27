import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const policyPath = new URL("../../src/lib/legalPolicies.ts", import.meta.url);

test("legal drafts cover the implemented payment logistics cancellation privacy and settlement contracts", async () => {
  const policy = await readFile(policyPath, "utf8");
  for (const phrase of [
    "수동 계좌이체", "통합 물류 그룹", "배송 단위마다 배송비 한 번", "즉시구매 구매자",
    "경매 낙찰자는", "판매자는", "보관", "Web Push", "채팅", "월 30,000원",
    "월 총 50,000원", "센터 등급과 관계없이 5%", "월·목요일 오후 6시 KST",
    "오후 6시부터 오후 9시 사이에 수동으로 처리",
    "10원 단위", "개인정보", "열람 기록", "반대 분개",
  ]) assert.ok(policy.includes(phrase), `missing policy phrase: ${phrase}`);
});

test("every policy remains explicitly gated on Korean legal review", async () => {
  const policy = await readFile(policyPath, "utf8");
  assert.match(policy, /한국 법률 전문가의 최종 검토 전/);
  assert.match(policy, /정식 확정본이 아닙니다/);
  assert.match(policy, /사업자등록번호 875-07-03297/);
  assert.match(policy, /0507-1494-3519/);
  assert.match(policy, /ninety-nine@kakao\.com/);
});

test("desktop and mobile policy pages share one canonical policy source", async () => {
  const paths = [
    "../../src/app/(shop)/terms/page.tsx", "../../src/app/(shop)/privacy/page.tsx", "../../src/app/(shop)/refund/page.tsx",
    "../../src/app/(mobile)/m/terms/page.tsx", "../../src/app/(mobile)/m/privacy/page.tsx", "../../src/app/(mobile)/m/refund/page.tsx",
  ];
  for (const path of paths) {
    const page = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(page, /@\/lib\/legalPolicies/);
  }
});
