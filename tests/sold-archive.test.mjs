import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const rootUrl = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

async function importPaginationHelpers() {
  const helperSource = await source("src/lib/soldArchivePagination.ts");
  const compiled = ts.transpileModule(helperSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );
}

async function importCompositeCursorHelpers() {
  const helperSource = await source(
    "src/lib/supabase/publicSoldAuctionPagination.ts",
  );
  const compiled = ts.transpileModule(helperSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );
}

async function render(path) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("sold-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("removes duplicate products when appending sold archive pages", async () => {
  const pagination = await importPaginationHelpers();
  const first = {
    productId: "product-1",
    soldAt: "2026-07-18T12:00:00.000Z",
  };
  const second = {
    productId: "product-2",
    soldAt: "2026-07-18T11:00:00.000Z",
  };
  const third = {
    productId: "product-3",
    soldAt: "2026-07-18T10:00:00.000Z",
  };

  assert.deepEqual(
    pagination
      .appendUniqueSoldAuctions([first, second], [second, third])
      .map((auction) => auction.productId),
    ["product-1", "product-2", "product-3"],
  );
});

test("keeps every same-time sale while advancing the composite cursor", async () => {
  const [pagination, composite] = await Promise.all([
    importPaginationHelpers(),
    importCompositeCursorHelpers(),
  ]);
  const soldAt = "2026-07-18T12:00:00.000Z";
  const allAuctions = Array.from({ length: 35 }, (_, index) => ({
    productId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    soldAt,
  })).sort((left, right) => right.productId.localeCompare(left.productId));
  let collected = [];
  let cursor = null;

  while (true) {
    const eligibleAuctions = cursor
      ? allAuctions.filter(
          (auction) =>
            auction.soldAt < cursor.soldAt ||
            (auction.soldAt === cursor.soldAt &&
              auction.productId < cursor.productId),
        )
      : allAuctions;
    const page = composite.createCompositeCursorPage(
      eligibleAuctions.slice(0, 25),
      24,
    );
    collected = pagination.appendUniqueSoldAuctions(collected, page.items);
    if (!page.hasMore || !page.nextCursor) break;
    cursor = page.nextCursor;
  }

  assert.equal(collected.length, 35);
  assert.deepEqual(
    collected.map((auction) => auction.productId),
    allAuctions.map((auction) => auction.productId),
  );
});

test("loads the sold archive in bounded cursor pages", async () => {
  const [route, page, repository, existingFeed] = await Promise.all([
    source("app/sold/page.tsx"),
    source("src/components/sold/SoldArchivePage.tsx"),
    source("src/lib/supabase/auctionLifecycle.ts"),
    source("src/components/feed/SoldAuctionFeed.tsx"),
  ]);

  assert.match(route, /<SoldArchivePage \/>/);
  assert.match(page, /type PublicSoldAuctionCursor/);
  assert.match(page, /fetchPublicSoldAuctionsPage\(\)/);
  assert.match(page, /fetchPublicSoldAuctionsPage\(\{ cursor \}\)/);
  assert.match(page, /setAuctions\(page\.auctions\)/);
  assert.match(page, /setHasMore\(page\.hasMore\)/);
  assert.match(page, /setNextCursor\(page\.nextCursor\)/);
  assert.doesNotMatch(page, /getSoldArchiveCursor|fetchPublicSoldAuctions\(/);
  assert.match(page, /판매 완료 더 보기/);
  assert.match(page, /formatKRW\(auction\.winningAmount\)/);
  assert.match(page, /auction\.winnerDisplayName/);
  assert.match(repository, /p_before_id: input\.beforeId \?\? null/);
  assert.match(repository, /fetchPublicSoldAuctionsPage/);
  assert.doesNotMatch(
    await source("src/lib/soldArchivePagination.ts"),
    /getSoldArchiveCursor/,
  );
  assert.doesNotMatch(existingFeed, /SoldArchivePage/);
});

test("server-renders the public sold archive without a 404", async () => {
  const response = await render("/sold");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /판매 완료 상품 전체보기/);
  assert.match(html, /판매 완료 상품을 불러오는 중/);
  assert.doesNotMatch(html, /404: NOT_FOUND|Code: NOT_FOUND/);
});
