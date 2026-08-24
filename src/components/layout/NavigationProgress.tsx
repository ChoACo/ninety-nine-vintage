"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const COMPLETE_DELAY_MS = 180;
const PROGRESS_TICK_MS = 180;

function isSameDocumentNavigation(anchor: HTMLAnchorElement): boolean {
  if (
    anchor.target === "_blank" ||
    anchor.hasAttribute("download") ||
    anchor.dataset.navigationProgress === "ignore"
  ) {
    return false;
  }
  try {
    const next = new URL(anchor.href, window.location.href);
    return (
      next.origin === window.location.origin &&
      `${next.pathname}${next.search}` !==
        `${window.location.pathname}${window.location.search}`
    );
  } catch {
    return false;
  }
}

/** Immediate global feedback for App Router links and router-driven controls. */
export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const [active, setActive] = useState(false);
  const [progress, setProgress] = useState(0);
  const activeRef = useRef(false);
  const completeTimer = useRef<number | null>(null);
  const failSafeTimer = useRef<number | null>(null);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const start = () => {
      if (completeTimer.current !== null) {
        window.clearTimeout(completeTimer.current);
        completeTimer.current = null;
      }
      if (failSafeTimer.current !== null) {
        window.clearTimeout(failSafeTimer.current);
      }
      setActive(true);
      setProgress((current) => (current > 0 ? current : 12));
      failSafeTimer.current = window.setTimeout(() => {
        setActive(false);
        setProgress(0);
        failSafeTimer.current = null;
      }, 10_000);
    };
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target as Element | null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (anchor && isSameDocumentNavigation(anchor)) start();
    };
    const onSubmit = (event: SubmitEvent) => {
      const form = event.target;
      if (form instanceof HTMLFormElement && form.method.toLowerCase() === "get") {
        start();
      }
    };
    const onNavigationStart = () => start();
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener("popstate", onNavigationStart);
    window.addEventListener("ninety-nine:navigation-start", onNavigationStart);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("popstate", onNavigationStart);
      window.removeEventListener(
        "ninety-nine:navigation-start",
        onNavigationStart,
      );
    };
  }, []);

  useEffect(() => {
    if (!activeRef.current) return;
    if (failSafeTimer.current !== null) {
      window.clearTimeout(failSafeTimer.current);
      failSafeTimer.current = null;
    }
    setProgress(100);
    completeTimer.current = window.setTimeout(() => {
      setActive(false);
      setProgress(0);
      completeTimer.current = null;
    }, COMPLETE_DELAY_MS);
  }, [routeKey]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      setProgress((current) =>
        Math.min(92, current + Math.max(1, (92 - current) * 0.12)),
      );
    }, PROGRESS_TICK_MS);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(
    () => () => {
      if (completeTimer.current !== null) {
        window.clearTimeout(completeTimer.current);
      }
      if (failSafeTimer.current !== null) {
        window.clearTimeout(failSafeTimer.current);
      }
    },
    [],
  );

  return (
    <div
      aria-hidden={!active}
      aria-label="페이지 이동 중"
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(progress)}
      className="navigation-progress"
      data-active={active ? "true" : "false"}
      role="progressbar"
    >
      <span style={{ transform: `scaleX(${progress / 100})` }} />
    </div>
  );
}
