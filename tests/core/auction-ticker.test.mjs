import assert from "node:assert/strict";
import test from "node:test";
import { getAuctionTimerState } from "../../src/utils/auctionTimer.ts";

test("auction ticker counts down to the KST auction close without a fixed publication time", () => {
  assert.deepEqual(
    getAuctionTimerState(new Date("2026-07-21T00:30:00Z")),
    {
      label: "오늘 경매 마감까지",
      status: "OPEN",
      timeLeft: "11:30:00",
      remainingSeconds: 41_400,
    },
  );
  assert.deepEqual(
    getAuctionTimerState(new Date("2026-07-21T11:55:00Z")),
    {
      label: "오늘 경매 마감까지",
      status: "OPEN",
      timeLeft: "00:05:00",
      remainingSeconds: 300,
    },
  );
  assert.deepEqual(
    getAuctionTimerState(new Date("2026-07-21T11:58:00Z")),
    {
      label: "오늘 경매 마감까지",
      status: "CLOSING_SOON",
      timeLeft: "00:02:00",
      remainingSeconds: 120,
    },
  );
  assert.deepEqual(
    getAuctionTimerState(new Date("2026-07-21T12:30:00Z")),
    {
      label: "경매 마감 및 동기화 점검 종료까지",
      status: "CLOSED",
      timeLeft: "00:30:00",
      remainingSeconds: 1_800,
    },
  );
  assert.deepEqual(
    getAuctionTimerState(new Date("2026-07-21T13:30:00Z")),
    {
      label: "미판매 경매 다음 마감까지",
      status: "RE_AUCTION",
      timeLeft: "22:30:00",
      remainingSeconds: 81_000,
    },
  );
});
