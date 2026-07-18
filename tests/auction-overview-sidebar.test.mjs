import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const overviewUrl = new URL(
  "../src/components/live/AuctionOverviewSidebar.tsx",
  import.meta.url,
);

test("operator auction overview includes only active products with real bids", async () => {
  const source = await readFile(overviewUrl, "utf8");

  assert.match(
    source,
    /post\.status === "active"\s*&&\s*post\.participantCount > 0\s*&&\s*post\.bidHistory\.length > 0/,
  );
  assert.match(source, /label: "입찰 확정"/);
  assert.match(source, /label: "입찰 진행"/);
  assert.doesNotMatch(source, /첫 입찰 대기/);
  assert.match(source, /현재 입찰자가 있는 진행 상품이 없습니다\./);
});
