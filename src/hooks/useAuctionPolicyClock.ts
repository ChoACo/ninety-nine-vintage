"use client";

import { useSyncExternalStore } from "react";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";

type ClockSubscriber = () => void;

const subscribers = new Set<ClockSubscriber>();
const serverSnapshot = new Date(0);
let currentSnapshot = new Date();
let intervalId: number | null = null;
let serverOffsetMs = 0;
let lastServerSyncAttemptMs = 0;
let serverSyncPromise: Promise<void> | null = null;
let lifecycleListenersAttached = false;
const SERVER_SYNC_INTERVAL_MS = 5 * 60_000;

const minuteSubscribers = new Set<ClockSubscriber>();
let currentMinuteSnapshot = new Date();
let minuteTimeoutId: number | null = null;
const MINUTE_MS = 60_000;
const MINUTE_BOUNDARY_GRACE_MS = 1;

function auctionNowMs() {
  return Date.now() + serverOffsetMs;
}

function publishClockSnapshots() {
  currentSnapshot = new Date(auctionNowMs());
  currentMinuteSnapshot = new Date(auctionNowMs());
  subscribers.forEach((subscriber) => subscriber());
  minuteSubscribers.forEach((subscriber) => subscriber());
}

export function synchronizeAuctionServerClock(force = false): Promise<void> {
  if (!LIVE_AUCTION_ENABLED) return Promise.resolve();
  const localNow = Date.now();
  if (
    !force &&
    (serverSyncPromise ||
      localNow - lastServerSyncAttemptMs < SERVER_SYNC_INTERVAL_MS)
  ) {
    return serverSyncPromise ?? Promise.resolve();
  }

  lastServerSyncAttemptMs = localNow;
  const requestedAt = Date.now();
  serverSyncPromise = import("@/lib/supabase/client")
    .then(({ getSupabaseBrowserClient }) =>
      getSupabaseBrowserClient().rpc("get_auction_server_time"),
    )
    .then(({ data, error }) => {
      const receivedAt = Date.now();
      const serverTime = typeof data === "string" ? Date.parse(data) : Number.NaN;
      if (error || !Number.isFinite(serverTime)) return;

      serverOffsetMs = serverTime - (requestedAt + receivedAt) / 2;
      publishClockSnapshots();
    })
    .catch(() => {
      // A failed sample keeps the safe server-side RPC as final authority. The
      // next focus or five-minute boundary retries without breaking the UI.
    })
    .finally(() => {
      serverSyncPromise = null;
    });
  return serverSyncPromise;
}

function maybeSynchronizeServerClock() {
  void synchronizeAuctionServerClock(false);
}

function handleClockVisibility() {
  if (typeof document === "undefined" || document.visibilityState === "visible") {
    void synchronizeAuctionServerClock(true);
  }
}

function ensureClockLifecycle() {
  if (lifecycleListenersAttached) return;
  if (typeof window.addEventListener !== "function") return;
  lifecycleListenersAttached = true;
  window.addEventListener("focus", handleClockVisibility);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleClockVisibility);
  }
}

function releaseClockLifecycle() {
  if (
    !lifecycleListenersAttached ||
    subscribers.size > 0 ||
    minuteSubscribers.size > 0
  ) {
    return;
  }
  lifecycleListenersAttached = false;
  window.removeEventListener("focus", handleClockVisibility);
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", handleClockVisibility);
  }
}

function tick() {
  currentSnapshot = new Date(auctionNowMs());
  subscribers.forEach((subscriber) => subscriber());
  maybeSynchronizeServerClock();
}

function subscribe(subscriber: ClockSubscriber) {
  subscribers.add(subscriber);
  ensureClockLifecycle();
  maybeSynchronizeServerClock();

  if (intervalId === null) {
    intervalId = window.setInterval(tick, 1_000);
  }

  return () => {
    subscribers.delete(subscriber);

    if (subscribers.size === 0 && intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
    releaseClockLifecycle();
  };
}

function getSnapshot() {
  return currentSnapshot;
}

function getServerSnapshot() {
  return serverSnapshot;
}

function subscribeToDisabledClock() {
  return () => {};
}

/** 다음 분의 00초를 놓치지 않도록 한 프레임보다 짧은 여유 뒤에 갱신합니다. */
export function getMillisecondsUntilNextMinute(nowMs: number): number {
  const elapsedInMinute = ((nowMs % MINUTE_MS) + MINUTE_MS) % MINUTE_MS;
  return MINUTE_MS - elapsedInMinute + MINUTE_BOUNDARY_GRACE_MS;
}

function scheduleMinuteTick() {
  minuteTimeoutId = window.setTimeout(
    tickMinute,
    getMillisecondsUntilNextMinute(auctionNowMs()),
  );
}

function tickMinute() {
  minuteTimeoutId = null;
  currentMinuteSnapshot = new Date(auctionNowMs());
  minuteSubscribers.forEach((subscriber) => subscriber());
  maybeSynchronizeServerClock();
  if (minuteSubscribers.size > 0) scheduleMinuteTick();
}

function subscribeToMinuteClock(subscriber: ClockSubscriber) {
  minuteSubscribers.add(subscriber);
  ensureClockLifecycle();
  maybeSynchronizeServerClock();

  if (minuteTimeoutId === null) {
    currentMinuteSnapshot = new Date(auctionNowMs());
    scheduleMinuteTick();
  }

  return () => {
    minuteSubscribers.delete(subscriber);

    if (minuteSubscribers.size === 0 && minuteTimeoutId !== null) {
      window.clearTimeout(minuteTimeoutId);
      minuteTimeoutId = null;
    }
    releaseClockLifecycle();
  };
}

function getMinuteSnapshot() {
  return currentMinuteSnapshot;
}

/**
 * 모든 피드 카드와 사이드바가 하나의 1초 타이머를 공유합니다.
 * 카드 수가 늘어도 상품마다 별도 setInterval을 만들지 않습니다.
 */
export function useAuctionPolicyClock(enabled = true): Date {
  const active = LIVE_AUCTION_ENABLED && enabled;
  return useSyncExternalStore(
    active ? subscribe : subscribeToDisabledClock,
    active ? getSnapshot : getServerSnapshot,
    getServerSnapshot,
  );
}

/**
 * 피드처럼 분 단위 정책 경계만 소비하는 화면을 위한 공유 시계입니다.
 * 20:56, 21:00, 22:00을 포함한 매 분 00초 직후에만 구독자를 갱신합니다.
 */
export function useAuctionPolicyMinuteClock(): Date {
  return useSyncExternalStore(
    LIVE_AUCTION_ENABLED ? subscribeToMinuteClock : subscribeToDisabledClock,
    LIVE_AUCTION_ENABLED ? getMinuteSnapshot : getServerSnapshot,
    getServerSnapshot,
  );
}

