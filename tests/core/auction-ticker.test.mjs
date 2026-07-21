import assert from "node:assert/strict";
import test from "node:test";
import { getAuctionTimerState } from "../../src/utils/auctionTimer.ts";

test("auction ticker labels each KST policy boundary truthfully", () => {
  assert.deepEqual(
    getAuctionTimerState(new Date("2026-07-21T11:55:00Z")),
    {
      label: "신규 참여 제한까지",
      status: "OPEN",
      timeLeft: "00:01:00",
      remainingSeconds: 60,
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
      label: "미판매 상품 재오픈까지",
      status: "CLOSED",
      timeLeft: "00:30:00",
      remainingSeconds: 1_800,
    },
  );
  assert.deepEqual(
    getAuctionTimerState(new Date("2026-07-21T13:00:00Z")),
    {
      label: "다음 신규 참여 제한까지",
      status: "RE_AUCTION",
      timeLeft: "22:56:00",
      remainingSeconds: 82_560,
    },
  );
});
