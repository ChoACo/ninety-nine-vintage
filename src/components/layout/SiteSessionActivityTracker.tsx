"use client";

import { useEffect } from "react";

export const CATALOG_SESSION_CHANGED_EVENT =
  "ninety-nine:catalog-session-changed";
export const CATALOG_SESSION_SEED_KEY =
  "ninety-nine:catalog-session-seed";

const LAST_SEEN_KEY = "ninety-nine:catalog-last-seen-at";
const SESSION_IDLE_MS = 10 * 60_000;
let volatileSeed = "";

export function getCatalogSessionSeed() {
  try {
    return localStorage.getItem(CATALOG_SESSION_SEED_KEY) ?? volatileSeed;
  } catch {
    return volatileSeed;
  }
}

function readLastSeen() {
  try {
    return Number(localStorage.getItem(LAST_SEEN_KEY) ?? "0");
  } catch {
    return 0;
  }
}

function writeSessionValue(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The in-memory seed still keeps this tab stable when storage is blocked.
  }
}

function resumeSiteSession() {
  const now = Date.now();
  const previousSeen = readLastSeen();
  let seed = getCatalogSessionSeed();
  if (!seed || !Number.isFinite(previousSeen) || now - previousSeen > SESSION_IDLE_MS) {
    seed = crypto.randomUUID();
    volatileSeed = seed;
    writeSessionValue(CATALOG_SESSION_SEED_KEY, seed);
  }
  writeSessionValue(LAST_SEEN_KEY, String(now));
  window.dispatchEvent(new Event(CATALOG_SESSION_CHANGED_EVENT));
}

function markSiteSeen() {
  writeSessionValue(LAST_SEEN_KEY, String(Date.now()));
}

export function SiteSessionActivityTracker() {
  useEffect(() => {
    resumeSiteSession();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") markSiteSeen();
    }, 60_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") resumeSiteSession();
      else markSiteSeen();
    };
    window.addEventListener("pagehide", markSiteSeen);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      markSiteSeen();
      window.clearInterval(interval);
      window.removeEventListener("pagehide", markSiteSeen);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return null;
}
