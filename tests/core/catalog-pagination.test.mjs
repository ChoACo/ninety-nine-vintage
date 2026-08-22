import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CATALOG_FETCH_BATCH_SIZE,
  getNextCatalogOffset,
  MAX_CATALOG_FETCH_BATCHES,
  mergeCatalogProductBatch,
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
  assert.doesNotMatch(route, /searchParams\.get\("sort"\)/);
  assert.doesNotMatch(grid, /sort:/);
  assert.match(grid, /mergeCatalogProductBatch\(products, batch\)/);
  assert.match(grid, /const visibleCards = useMemo\([\s\S]*?\(\) =>[\s\S]*?cards[\s\S]*?\.filter/);
  assert.doesNotMatch(grid, /sortCatalogProducts\(products, sort\)/);
  assert.match(grid, /pagination\.offset !== offset/);
  assert.match(grid, /computedNextOffset === null/);
});
