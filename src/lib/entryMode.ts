"use client";

import { useSyncExternalStore } from "react";

export const ENTRY_READONLY_KEY = "ninetynine-entry-readonly";

export function isEntryReadOnly() {
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
