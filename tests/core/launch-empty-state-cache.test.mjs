import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  clearCommerceLocalCache,
  clearLegacyEmptyDataIndexedDbCaches,
  readCommerceLocalCache,
  writeCommerceLocalCache,
} from "../../src/lib/cache/localCache.ts";

const root = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("local commerce cache normalizes corrupt values and clears without throwing", () => {
  const previousWindow = globalThis.window;
  const values = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, value),
    },
  };
  try {
    values.set("ninetynine-commerce-cache", "{broken");
    assert.deepEqual(readCommerceLocalCache(), { cartIds: [], likedIds: [] });
    writeCommerceLocalCache({
      cartIds: ["product-a", "product-a", ""],
      likedIds: ["product-b"],
    });
    assert.deepEqual(readCommerceLocalCache(), {
      cartIds: ["product-a"],
      likedIds: ["product-b"],
    });
    clearCommerceLocalCache();
    assert.deepEqual(readCommerceLocalCache(), { cartIds: [], likedIds: [] });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("only app-owned legacy IndexedDB caches are deleted", async () => {
  const previousWindow = globalThis.window;
  const deleted = [];
  globalThis.window = {
    indexedDB: {
      databases: async () => [
        { name: "ninetynine-cart-v1" },
        { name: "ninetynine-storage-v1" },
        { name: "unrelated-app" },
      ],
      deleteDatabase: (name) => deleted.push(name),
    },
  };
  try {
    await clearLegacyEmptyDataIndexedDbCaches();
    assert.deepEqual(deleted, [
      "ninetynine-cart-v1",
      "ninetynine-storage-v1",
    ]);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("authoritative empty responses reconcile cart, storage, and badge state", async () => {
  const [commerce, cartStore, cartView, account] = await Promise.all([
    source("src/store/useCommerceStore.ts"),
    source("src/store/useCartStore.ts"),
    source("src/components/features/commerce/CartView.tsx"),
    source("src/components/features/account/AccountDashboard.tsx"),
  ]);
  assert.match(commerce, /clearEmptyProductDataCaches/);
  assert.match(commerce, /Array\.isArray\(cartPayload\.productIds\)/);
  assert.match(cartStore, /reconcileCartIds/);
  assert.match(cartView, /cachedResult\.authoritative/);
  assert.match(cartView, /reconcileCartIds\(ids\)/);
  assert.match(account, /storageResponse\.ok && storageItems\.length === 0/);
  assert.match(account, /clearLegacyEmptyDataIndexedDbCaches/);
});

test("launch empty states use the approved customer-facing copy", async () => {
  const [home, shop, cart, storage] = await Promise.all([
    source("src/components/features/home/HomeFeaturedAuction.tsx"),
    source("src/components/features/auction/AuctionFeedGrid.tsx"),
    source("src/components/features/commerce/CartView.tsx"),
    source("src/components/features/account/AccountDashboard.tsx"),
  ]);
  assert.match(home, /오늘 밤의 실시간 경매를 준비 중입니다\./);
  assert.match(shop, /등록된 상품이 없습니다\./);
  assert.match(cart, /장바구니가 비어 있습니다\./);
  assert.match(storage, /현재 보관 중인 상품이 없습니다\./);
});

test("store and platform services retain database-backed banner fields", async () => {
  const [stores, platform] = await Promise.all([
    source("src/services/stores.ts"),
    source("src/services/platformConfig.ts"),
  ]);
  assert.match(stores, /banner_url/);
  assert.match(stores, /mall_image/);
  assert.match(platform, /global_delivery_fee,storage_duration_days,home_sections,banners/);
});
