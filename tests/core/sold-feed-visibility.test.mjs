import assert from "node:assert/strict";
import test from "node:test";
import { isSoldFeedVisible, soldFeedVisibleAt } from "../../src/lib/catalog/soldVisibility.ts";

test("closed auctions enter sold discovery at 10:00 KST on the following day", () => {
  assert.equal(soldFeedVisibleAt("2026-08-10T12:00:00.000Z")?.toISOString(), "2026-08-11T01:00:00.000Z");
  assert.equal(isSoldFeedVisible("2026-08-10T12:00:00.000Z", new Date("2026-08-11T00:59:59.999Z")), false);
  assert.equal(isSoldFeedVisible("2026-08-10T12:00:00.000Z", new Date("2026-08-11T01:00:00.000Z")), true);
});
