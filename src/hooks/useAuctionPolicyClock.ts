"use client";

import { useSyncExternalStore } from "react";

type ClockSubscriber = () => void;

const subscribers = new Set<ClockSubscriber>();
const serverSnapshot = new Date(0);
let currentSnapshot = new Date();
let intervalId: number | null = null;

const minuteSubscribers = new Set<ClockSubscriber>();
let currentMinuteSnapshot = new Date();
let minuteTimeoutId: number | null = null;
const MINUTE_MS = 60_000;
const MINUTE_BOUNDARY_GRACE_MS = 1;

function tick() {
  currentSnapshot = new Date();
  subscribers.forEach((subscriber) => subscriber());
}

function subscribe(subscriber: ClockSubscriber) {
  subscribers.add(subscriber);

  if (intervalId === null) {
    intervalId = window.setInterval(tick, 1_000);
  }

  return () => {
    subscribers.delete(subscriber);

    if (subscribers.size === 0 && intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
  };
}

function getSnapshot() {
  return currentSnapshot;
}

function getServerSnapshot() {
  return serverSnapshot;
}

/** 다음 분의 00초를 놓치지 않도록 한 프레임보다 짧은 여유 뒤에 갱신합니다. */
export function getMillisecondsUntilNextMinute(nowMs: number): number {
  const elapsedInMinute = ((nowMs % MINUTE_MS) + MINUTE_MS) % MINUTE_MS;
  return MINUTE_MS - elapsedInMinute + MINUTE_BOUNDARY_GRACE_MS;
}

function scheduleMinuteTick() {
  minuteTimeoutId = window.setTimeout(
    tickMinute,
    getMillisecondsUntilNextMinute(Date.now()),
  );
}

function tickMinute() {
  minuteTimeoutId = null;
  currentMinuteSnapshot = new Date();
  minuteSubscribers.forEach((subscriber) => subscriber());
  if (minuteSubscribers.size > 0) scheduleMinuteTick();
}

function subscribeToMinuteClock(subscriber: ClockSubscriber) {
  minuteSubscribers.add(subscriber);

  if (minuteTimeoutId === null) {
    currentMinuteSnapshot = new Date();
    scheduleMinuteTick();
  }

  return () => {
    minuteSubscribers.delete(subscriber);

    if (minuteSubscribers.size === 0 && minuteTimeoutId !== null) {
      window.clearTimeout(minuteTimeoutId);
      minuteTimeoutId = null;
    }
  };
}

function getMinuteSnapshot() {
  return currentMinuteSnapshot;
}

/**
 * 모든 피드 카드와 사이드바가 하나의 1초 타이머를 공유합니다.
 * 카드 수가 늘어도 상품마다 별도 setInterval을 만들지 않습니다.
 */
export function useAuctionPolicyClock(): Date {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * 피드처럼 분 단위 정책 경계만 소비하는 화면을 위한 공유 시계입니다.
 * 20:56, 21:00, 22:00을 포함한 매 분 00초 직후에만 구독자를 갱신합니다.
 */
export function useAuctionPolicyMinuteClock(): Date {
  return useSyncExternalStore(
    subscribeToMinuteClock,
    getMinuteSnapshot,
    getServerSnapshot,
  );
}
