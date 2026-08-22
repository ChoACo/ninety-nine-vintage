import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("MY auction history exposes payment only for unsettled authoritative wins", async () => {
  const [route, history] = await Promise.all([
    source("src/app/api/account/bids/route.ts"),
    source("src/components/features/account/BidHistory.tsx"),
  ]);

  assert.match(route, /rpc\("get_my_won_products"\)/);
  assert.match(route, /won\?\.is_payment_settled\s*\?\s*"settled"/);
  assert.match(route, /won\s*\?\s*"final"/);
  assert.match(
    history,
    /item\.state === "final"[^]*checkout\?type=auction&id=/,
  );
  assert.match(history, /item\.state === "settled"[^]*my\/vault/);
  assert.match(history, /결제 완료 · 보관함 이동/);
});

test("vault cards always render a D-Day progress gauge from authoritative storage dates", async () => {
  const dashboard = await source(
    "src/components/features/account/AccountDashboard.tsx",
  );

  assert.match(dashboard, /item\.storageStartedAt/);
  assert.match(dashboard, /item\.storageExpiresAt/);
  assert.match(dashboard, /item\.storageDurationDays \* 86_400_000/);
  assert.match(dashboard, /role="progressbar"/);
  assert.match(dashboard, /결제 완료 시점 기준 보관 기한 확인 중/);
  assert.doesNotMatch(
    dashboard,
    /매장 입고 후 시작|매장 보관 시작일|보관 시작 전|입고 후 D-|매장 출고 전/,
  );
  assert.match(dashboard, /daysRemaining !== null && daysRemaining <= 3/);
  assert.match(dashboard, /daysRemaining === 0[^]*오늘 보관 만료/);
  assert.match(dashboard, /만료 임박 · 묶음 배송 신청 권장/);
});
