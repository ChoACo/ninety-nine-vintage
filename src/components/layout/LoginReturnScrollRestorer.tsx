"use client";

import { useEffect } from "react";
import { readReturnScroll } from "@/lib/browser/returnScroll";

// Restores the scroll position captured before login once the member lands
// back on the same browsing surface. Runs after the first paint and again on
// window load so lazy-loaded images do not shift the restored position.
export function LoginReturnScrollRestorer() {
  useEffect(() => {
    let restored = false;
    const restore = () => {
      if (restored) return;
      const scrollY = readReturnScroll(window.location.pathname);
      if (scrollY === null) return;
      restored = true;
      window.scrollTo(0, scrollY);
    };
    const timeout = window.setTimeout(restore, 0);
    window.addEventListener("load", restore);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("load", restore);
    };
  }, []);

  return null;
}
