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

function atTime(date: Date, hours: number, minutes = 0, seconds = 0) {
  const target = new Date(date);
  target.setHours(hours, minutes, seconds, 0);
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
  const opensAt = atTime(now, 10);
  const biddingRestrictedAt = atTime(now, 20, 56);
  const closesAt = atTime(now, 21);
  const reAuctionStartsAt = atTime(now, 22);
  const endOfDay = atTime(now, 24);

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
