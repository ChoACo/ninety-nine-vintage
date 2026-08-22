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
    /item\.state === "final"[^]*account\/payments\?productId=/,
  );
  assert.match(history, /item\.state === "settled"[^]*account\/storage/);
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
  assert.match(dashboard, /입고 후 D-\$\{item\.storageDurationDays\} 시작/);
  assert.match(dashboard, /daysRemaining !== null && daysRemaining <= 3/);
});
