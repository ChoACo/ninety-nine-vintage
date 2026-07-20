"use client";

import { useSyncExternalStore } from "react";
import { ENTRY_GATE_ENABLED } from "@/lib/featureFlags";

export const ENTRY_READONLY_KEY = "ninetynine-entry-readonly";

export function isEntryReadOnly() {
  if (!ENTRY_GATE_ENABLED) return false;
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("mode") === "readonly" || window.sessionStorage.getItem(ENTRY_READONLY_KEY) === "1";
  } catch {
    return new URLSearchParams(window.location.search).get("mode") === "readonly";
  }
}

const subscribeToEntryMode = (onStoreChange: () => void) => {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
};

export function useEntryReadOnly() {
  return useSyncExternalStore(subscribeToEntryMode, isEntryReadOnly, () => false);
}
