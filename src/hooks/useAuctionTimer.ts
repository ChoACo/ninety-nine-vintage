"use client";

import { useEffect, useState } from "react";
import type { AuctionStatus } from "@/types/auction";

type AuctionClockStatus = AuctionStatus | "UPCOMING" | "OPEN" | "CLOSING_SOON" | "CLOSED" | "RE_AUCTION";

interface AuctionTimerState {
  status: AuctionClockStatus;
  timeLeft: string;
  remainingSeconds: number;
}

const INITIAL_STATE: AuctionTimerState = {
  status: "UPCOMING",
  timeLeft: "00:00:00",
  remainingSeconds: 0,
};

function kstDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function atKstTime(date: Date, hours = 0, minutes = 0, seconds = 0, nextDay = false) {
  const target = new Date(`${kstDateParts(date)}T00:00:00+09:00`);
  if (nextDay) target.setUTCDate(target.getUTCDate() + 1);
  target.setUTCHours(hours - 9, minutes, seconds, 0);
  return target;
}

function formatTime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((unit) => String(unit).padStart(2, "0"))
    .join(":");
}

function getAuctionTimerState(now = new Date()): AuctionTimerState {
  const opensAt = atKstTime(now, 10);
  const biddingRestrictedAt = atKstTime(now, 20, 56);
  const closesAt = atKstTime(now, 21);
  const reAuctionStartsAt = atKstTime(now, 22);
  const endOfDay = atKstTime(now, 0, 0, 0, true);

  let status: AuctionClockStatus;
  let target: Date;

  if (now < opensAt) {
    status = "UPCOMING";
    target = opensAt;
  } else if (now < biddingRestrictedAt) {
    status = "OPEN";
    target = biddingRestrictedAt;
  } else if (now < closesAt) {
    status = "CLOSING_SOON";
    target = closesAt;
  } else if (now < reAuctionStartsAt) {
    status = "CLOSED";
    target = reAuctionStartsAt;
  } else {
    status = "RE_AUCTION";
    target = endOfDay;
  }

  const remainingSeconds = Math.max(
    0,
    Math.floor((target.getTime() - now.getTime()) / 1000),
  );

  return {
    status,
    timeLeft: formatTime(remainingSeconds),
    remainingSeconds,
  };
}

export function useAuctionTimer(): AuctionTimerState {
  const [timer, setTimer] = useState<AuctionTimerState>(INITIAL_STATE);

  useEffect(() => {
    const updateTimer = () => setTimer(getAuctionTimerState());
    updateTimer();

    const intervalId = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  return timer;
}
