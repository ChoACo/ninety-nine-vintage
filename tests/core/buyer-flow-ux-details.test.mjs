import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("cart pending locks remain visible and fail closed until released", async () => {
  const [route, view] = await Promise.all([
    source("src/app/api/cart/route.ts"),
    source("src/components/features/commerce/CartView.tsx"),
  ]);

  assert.match(route, /pendingLockByProductId/);
  assert.match(route, /status === "closed" && pendingLockByProductId\.has/);
  assert.match(route, /pendingLock: pendingLockByProductId\.get/);
  assert.match(view, /다른 회원이 결제 진행 중 \(선점\)/);
  assert.match(view, /hasPendingProductLock \|\|/);
  assert.match(view, /table: "products"/);
  assert.match(view, /window\.setInterval\(refresh, 15_000\)/);
});

test("cart and vault explain an available zero-won bundled-shipping benefit", async () => {
  const [cart, storageRoute, vault] = await Promise.all([
    source("src/components/features/commerce/CartView.tsx"),
    source("src/app/api/account/storage/route.ts"),
    source("src/components/features/account/AccountDashboard.tsx"),
  ]);

  assert.match(cart, /🎉 묶음배송 혜택: 배송비 0원 적용/);
  assert.match(storageRoute, /id, business_id, storage_class_snapshot/);
  assert.match(storageRoute, /businessId: details\?\.business_id \?\? null/);
  assert.match(vault, /\.map\(\(item\) => item\.businessId\)/);
  assert.match(vault, /선택 \$\{selectedInventoryItems\.length\}개 \/ 배송비 0원 \/ 추가 결제 없음/);
});

test("manual-transfer receipts provide copy feedback and a live deadline", async () => {
  const [cart, orderHistory, copyButton, countdown] = await Promise.all([
    source("src/components/features/commerce/CartView.tsx"),
    source("src/components/features/account/OrderHistory.tsx"),
    source("src/components/ui/CopyAccountButton.tsx"),
    source("src/components/ui/PaymentDeadlineCountdown.tsx"),
  ]);

  assert.match(cart, /<CopyAccountButton/);
  assert.match(cart, /<PaymentDeadlineCountdown/);
  assert.match(orderHistory, /무통장 입금 안내/);
  assert.match(copyButton, /계좌번호를 복사했습니다/);
  assert.match(copyButton, /복사 완료/);
  assert.match(countdown, /입금 마감까지 남은 시간/);
  assert.match(countdown, /window\.setInterval\(tick, 1_000\)/);
});
