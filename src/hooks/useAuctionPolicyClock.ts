"use client";

import { useSyncExternalStore } from "react";

type ClockSubscriber = () => void;

const subscribers = new Set<ClockSubscriber>();
const serverSnapshot = new Date(0);
let currentSnapshot = new Date();
let intervalId: number | null = null;

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

/**
 * 모든 피드 카드와 사이드바가 하나의 1초 타이머를 공유합니다.
 * 카드 수가 늘어도 상품마다 별도 setInterval을 만들지 않습니다.
 */
export function useAuctionPolicyClock(): Date {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
