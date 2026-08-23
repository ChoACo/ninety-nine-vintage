import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { deriveCartPricing } from "../../src/lib/commerce/cartPricing.ts";

const charges = [
  { amount: 4_000, productIds: ["a-1", "a-2"], vaultAmount: 0 },
  { amount: 4_000, productIds: ["b-1"], vaultAmount: 4_000 },
];

test("cart totals immediately follow remaining products and shipping units", () => {
  const initial = deriveCartPricing(
    [
      { id: "a-1", price: 10_000 },
      { id: "b-1", price: 20_000 },
    ],
    charges,
    "ship",
  );
  assert.deepEqual(
    [initial.productTotal, initial.shippingFee, initial.finalAmount],
    [30_000, 8_000, 38_000],
  );

  const afterStoreRemoval = deriveCartPricing(
    [{ id: "b-1", price: 20_000 }],
    charges,
    "ship",
  );
  assert.deepEqual(
    [
      afterStoreRemoval.productTotal,
      afterStoreRemoval.shippingFee,
      afterStoreRemoval.finalAmount,
    ],
    [20_000, 4_000, 24_000],
  );
  assert.equal(afterStoreRemoval.activeCharges.length, 1);
});

test("removing one of multiple products from the same shipping unit keeps one fee", () => {
  const pricing = deriveCartPricing(
    [{ id: "a-2", price: 15_000 }],
    charges,
    "ship",
  );
  assert.equal(pricing.shippingFee, 4_000);
  assert.equal(pricing.finalAmount, 19_000);
});

test("vault pricing removes only the remaining unit's authoritative prepaid fee", () => {
  const withBothStores = deriveCartPricing(
    [
      { id: "a-1", price: 10_000 },
      { id: "b-1", price: 20_000 },
    ],
    charges,
    "vault",
  );
  assert.equal(withBothStores.shippingFee, 4_000);

  const afterPaidUnitRemoval = deriveCartPricing(
    [{ id: "a-1", price: 10_000 }],
    charges,
    "vault",
  );
  assert.equal(afterPaidUnitRemoval.shippingFee, 0);
  assert.equal(afterPaidUnitRemoval.finalAmount, 10_000);
});

test("an empty cart always resets every payment amount to zero", () => {
  const pricing = deriveCartPricing([], charges, "ship");
  assert.deepEqual(
    [pricing.productTotal, pricing.shippingFee, pricing.finalAmount],
    [0, 0, 0],
  );
  assert.equal(pricing.activeCharges.length, 0);
});

test("cart removal updates the shared badge first and persists in the background", async () => {
  const [cartView, bottomNav] = await Promise.all([
    readFile(
      new URL("../../src/components/features/commerce/CartView.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../src/components/mobile/MobileSiteBottomNav.tsx", import.meta.url),
      "utf8",
    ),
  ]);
  const optimisticRemoval = cartView.indexOf("removeFromCart(productId)");
  const persistence = cartView.indexOf(
    "await persistCart(productId, false, buyerId)",
    optimisticRemoval,
  );
  assert.ok(optimisticRemoval >= 0 && persistence > optimisticRemoval);
  assert.match(cartView, /상품이 장바구니에서 삭제되었습니다/);
  assert.match(cartView, /products\.length === 0/);
  assert.match(cartView, /상품을 담아주세요/);
  assert.match(bottomNav, /state\) => state\.cartIds\.length/);
});
