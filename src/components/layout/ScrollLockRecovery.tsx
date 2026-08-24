"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { recoverBodyScroll } from "@/lib/browser/bodyScrollLock";

// Only overlays that acquire a lock may suppress recovery. Generic aria-modal
// elements include legacy dialogs that never lock the page and could otherwise
// keep an unrelated stale lock stranded after navigation.
const ACTIVE_OVERLAY_SELECTOR = '[data-scroll-lock-owner]';

export function ScrollLockRecovery() {
  const pathname = usePathname();

  useEffect(() => {
    let frame = 0;
    const recoverIfOrphaned = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (!document.querySelector(ACTIVE_OVERLAY_SELECTOR)) {
          recoverBodyScroll();
        }
      });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") recoverIfOrphaned();
    };

    recoverIfOrphaned();
    window.addEventListener("pageshow", recoverIfOrphaned);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pageshow", recoverIfOrphaned);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pathname]);

  return null;
}
