import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CATALOG_FETCH_BATCH_SIZE,
  getNextCatalogOffset,
  MAX_CATALOG_FETCH_BATCHES,
  mergeCatalogProductBatch,
  sortCatalogProducts,
} from "../../src/lib/catalog/pagination.ts";
import { normalizeProductOffset } from "../../src/lib/catalog/query.ts";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("catalog offsets are finite, integer, non-negative, and bounded", () => {
  assert.equal(normalizeProductOffset(Number.NaN), 0);
  assert.equal(normalizeProductOffset(Number.POSITIVE_INFINITY, 17), 17);
  assert.equal(normalizeProductOffset(-4), 0);
  assert.equal(normalizeProductOffset(12.9), 12);
  assert.equal(normalizeProductOffset(10_000_000), 1_000_000);
});

test("catalog batches deduplicate by id without destabilizing server order", () => {
  const merged = mergeCatalogProductBatch(
    [{ id: "a", value: 1 }, { id: "b", value: 2 }],
    [{ id: "b", value: 20 }, { id: "c", value: 3 }, { id: "", value: 4 }],
  );
  assert.deepEqual(merged, [
    { id: "a", value: 1 },
    { id: "b", value: 20 },
    { id: "c", value: 3 },
  ]);
});

test("catalog batch progression stops on a short page and rejects unsafe ranges", () => {
  assert.equal(CATALOG_FETCH_BATCH_SIZE, 100);
  assert.equal(MAX_CATALOG_FETCH_BATCHES, 100);
  assert.equal(getNextCatalogOffset(0, 100), 100);
  assert.equal(getNextCatalogOffset(100, 24), null);
  assert.throws(() => getNextCatalogOffset(-1, 100), RangeError);
  assert.throws(() => getNextCatalogOffset(0, 101), RangeError);
  assert.throws(
    () => getNextCatalogOffset(Number.MAX_SAFE_INTEGER, 100),
    RangeError,
  );
});

test("catalog UI sorting is deterministic after immutable batches are merged", () => {
  const products = [
    { closesAt: "2026-07-21T12:00:00Z", currentPrice: 30_000, fixedPrice: null, id: "b", publishAt: "2026-07-21T10:00:00Z", saleType: "auction" },
    { closesAt: "2026-07-21T11:00:00Z", currentPrice: 30_000, fixedPrice: null, id: "a", publishAt: "2026-07-21T10:00:00Z", saleType: "auction" },
    { closesAt: "2026-07-21T13:00:00Z", currentPrice: 10_000, fixedPrice: null, id: "c", publishAt: "2026-07-21T11:00:00Z", saleType: "auction" },
  ];

  assert.deepEqual(sortCatalogProducts(products, "latest").map(({ id }) => id), ["c", "a", "b"]);
  assert.deepEqual(sortCatalogProducts(products, "ending").map(({ id }) => id), ["a", "b", "c"]);
  assert.deepEqual(sortCatalogProducts(products, "price_asc").map(({ id }) => id), ["c", "a", "b"]);
  assert.deepEqual(sortCatalogProducts(products, "price_desc").map(({ id }) => id), ["a", "b", "c"]);
  assert.deepEqual(products.map(({ id }) => id), ["b", "a", "c"]);

  const fixedProducts = [
    { closesAt: "2026-07-21T12:00:00Z", currentPrice: 1, fixedPrice: 50_000, id: "fixed-b", publishAt: "2026-07-21T10:00:00Z", saleType: "fixed" },
    { closesAt: "2026-07-21T12:00:00Z", currentPrice: 999_999, fixedPrice: 20_000, id: "fixed-a", publishAt: "2026-07-21T10:00:00Z", saleType: "fixed" },
  ];
  assert.deepEqual(sortCatalogProducts(fixedProducts, "price_asc").map(({ id }) => id), ["fixed-a", "fixed-b"]);
});

test("public product API and feed retain bounded, stable, abortable full-catalog loading", async () => {
  const [service, route, grid] = await Promise.all([
    source("src/services/products.ts"),
    source("src/app/api/products/route.ts"),
    source("src/components/features/auction/AuctionFeedGrid.tsx"),
  ]);

  assert.match(service, /offset\?: number/);
  assert.match(service, /normalizeProductOffset\(offset\)/);
  assert.match(service, /query\.order\("id", \{ ascending: true \}\)/);
  assert.match(service, /query\.range\(safeOffset, safeOffset \+ safeLimit - 1\)/);

  assert.match(route, /normalizeProductOffset\(searchParams\.get\("offset"\)/);
  assert.match(route, /pagination:\s*\{/);
  assert.match(route, /nextOffset:\s*hasMore \? offset \+ products\.length : null/);

  assert.match(grid, /batchIndex < MAX_CATALOG_FETCH_BATCHES/);
  assert.match(grid, /input\.signal\.throwIfAborted\(\)/);
  assert.match(grid, /sort:\s*"latest"/);
  assert.doesNotMatch(grid, /sort:\s*input\.sort/);
  assert.match(grid, /mergeCatalogProductBatch\(products, batch\)/);
  assert.match(grid, /sortCatalogProducts\(products, sort\)/);
  assert.match(grid, /pagination\.offset !== offset/);
  assert.match(grid, /computedNextOffset === null/);
});
