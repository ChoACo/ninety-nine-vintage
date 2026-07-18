import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const rootUrl = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

async function importClockWithStoreProbe() {
  const clockSource = await source("src/hooks/useAuctionPolicyClock.ts");
  const compiled = ts.transpileModule(clockSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const importless = compiled.replace(
    'import { useSyncExternalStore } from "react";',
    "const useSyncExternalStore = (subscribe, getSnapshot, getServerSnapshot) => ({ subscribe, getSnapshot, getServerSnapshot });",
  );
  return import(
    `data:text/javascript;base64,${Buffer.from(importless).toString("base64")}`
  );
}

test("aligns minute policy refreshes just after every minute boundary", async () => {
  const clock = await importClockWithStoreProbe();

  assert.equal(
    clock.getMillisecondsUntilNextMinute(
      Date.parse("2026-07-18T20:55:59.990+09:00"),
    ),
    11,
  );
  assert.equal(
    clock.getMillisecondsUntilNextMinute(
      Date.parse("2026-07-18T20:59:59.999+09:00"),
    ),
    2,
  );
  assert.equal(
    clock.getMillisecondsUntilNextMinute(
      Date.parse("2026-07-18T21:59:00.000+09:00"),
    ),
    60_001,
  );
});

test("shares one minute timer and releases it after the final subscriber", async () => {
  const timers = new Map();
  let nextTimerId = 0;
  let clearCount = 0;
  globalThis.window = {
    setTimeout(callback, delay) {
      const id = ++nextTimerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      clearCount += 1;
      timers.delete(id);
    },
  };

  try {
    const clock = await importClockWithStoreProbe();
    const firstStore = clock.useAuctionPolicyMinuteClock();
    const secondStore = clock.useAuctionPolicyMinuteClock();
    let firstTicks = 0;
    let secondTicks = 0;

    const unsubscribeFirst = firstStore.subscribe(() => {
      firstTicks += 1;
    });
    const unsubscribeSecond = secondStore.subscribe(() => {
      secondTicks += 1;
    });

    assert.equal(timers.size, 1);
    const [timerId, timer] = timers.entries().next().value;
    assert.ok(timer.delay >= 1 && timer.delay <= 60_001);

    // A browser removes a one-shot timer immediately before invoking it.
    timers.delete(timerId);
    timer.callback();
    assert.equal(firstTicks, 1);
    assert.equal(secondTicks, 1);
    assert.equal(timers.size, 1);

    unsubscribeFirst();
    assert.equal(timers.size, 1);
    unsubscribeSecond();
    assert.equal(timers.size, 0);
    assert.equal(clearCount, 1);
  } finally {
    delete globalThis.window;
  }
});

test("uses the shared server-adjusted second clock on every bid deadline surface", async () => {
  const [clock, auctionClock, feed, postCard, sidebar, countdown] = await Promise.all([
    source("src/hooks/useAuctionPolicyClock.ts"),
    source("src/hooks/useAuctionClock.ts"),
    source("src/components/feed/FeedList.tsx"),
    source("src/components/feed/PostCard.tsx"),
    source("src/components/live/LiveBidSidebar.tsx"),
    source("src/hooks/usePaymentDeadlineCountdown.ts"),
  ]);

  assert.match(clock, /export function useAuctionPolicyClock\(\): Date/);
  assert.match(clock, /window\.setInterval\(tick, 1_000\)/);
  assert.match(clock, /rpc\("get_auction_server_time"\)/);
  assert.match(clock, /serverOffsetMs = serverTime - \(requestedAt \+ receivedAt\) \/ 2/);
  assert.match(clock, /export function useAuctionPolicyMinuteClock\(\): Date/);
  assert.match(auctionClock, /const currentTime = useAuctionPolicyClock\(\)/);
  assert.doesNotMatch(auctionClock, /window\.setInterval/);
  assert.match(feed, /const auctionNow = useAuctionPolicyClock\(\)/);
  assert.match(sidebar, /const auctionNow = useAuctionPolicyClock\(\)/);
  assert.doesNotMatch(feed, /useAuctionPolicyMinuteClock\(\)/);
  assert.doesNotMatch(sidebar, /useAuctionPolicyMinuteClock\(\)/);
  assert.match(countdown, /const currentTime = useAuctionPolicyClock\(\)/);
  assert.match(postCard, /assertAuctionBidAllowed\(\{[\s\S]*now: auctionNow/);
  assert.match(sidebar, /assertAuctionBidAllowed\(\{[\s\S]*now: auctionNow/);
});
