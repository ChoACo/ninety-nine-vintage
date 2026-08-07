"use client";

import { useEffect, useState } from "react";
import { useToastStore } from "@/store/useToastStore";

export const BID_RATE_LIMIT_MESSAGE =
  "입찰 요청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.";

const RATE_LIMIT_COOLDOWN_MS = 3_000;

export function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("Retry-After");
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds * 1_000;
}

export function useBidRateLimitCooldown() {
  const pushToast = useToastStore((state) => state.pushToast);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (cooldownUntil === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  const cooldownLeft = Math.max(0, cooldownUntil - now);
  const isCoolingDown = cooldownUntil > 0 && cooldownLeft > 0;
  const cooldownSeconds = Math.max(1, Math.ceil(cooldownLeft / 1000));

  const beginCooldown = (durationMs: number | null = null) => {
    pushToast("error", BID_RATE_LIMIT_MESSAGE);
    const waitMs = Math.max(
      RATE_LIMIT_COOLDOWN_MS,
      durationMs ?? RATE_LIMIT_COOLDOWN_MS,
    );
    setCooldownUntil(Date.now() + waitMs);
    setNow(Date.now());
  };

  return { cooldownLeft, cooldownSeconds, isCoolingDown, beginCooldown };
}

export function isRateLimitedResponse(response: Response): boolean {
  return response.status === 429;
}
