"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { recoverBodyScroll } from "@/lib/browser/bodyScrollLock";

const ACTIVE_OVERLAY_SELECTOR = [
  '[aria-modal="true"]',
  '[data-premium-modal-layer]',
  '[data-mobile-drawer-open="true"]',
].join(",");

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
