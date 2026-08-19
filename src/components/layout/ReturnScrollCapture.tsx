"use client";

import { useEffect } from "react";
import {
  isLoginNavigationUrl,
  isReturnableLoginSurface,
  saveReturnScroll,
} from "@/lib/browser/returnScroll";

// Captures the current scroll position before a guest leaves a browsing
// surface for the login flow, so the exact position can be restored after the
// Kakao round trip. The capture phase runs before any React handler, which
// covers header links, card buttons and router.push-based navigation alike.
export function ReturnScrollCapture() {
  useEffect(() => {
    const onCaptureClick = (event: MouseEvent) => {
      if (!isReturnableLoginSurface(window.location.pathname)) return;
      const target = event.target as Element | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || !isLoginNavigationUrl(anchor.href)) return;
      saveReturnScroll(window.location.pathname);
    };
    document.addEventListener("click", onCaptureClick, true);
    return () => document.removeEventListener("click", onCaptureClick, true);
  }, []);

  return null;
}
