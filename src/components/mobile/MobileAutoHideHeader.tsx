"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useScrollDirection } from "@/hooks/useScrollDirection";

export function MobileAutoHideHeader({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { direction, scrollY } = useScrollDirection();
  const hidden = direction === "down" && scrollY >= 50;

  useEffect(() => {
    const surface = wrapperRef.current?.closest(
      '[data-ui-surface="mobile"]',
    ) as HTMLElement | null | undefined;
    if (!surface) return;
    surface.dataset.mobileHeaderHidden = String(hidden);
    return () => {
      delete surface.dataset.mobileHeaderHidden;
    };
  }, [hidden, pathname]);

  return (
    <div
      className={`sticky top-0 z-[70] w-full border-b border-zinc-800/80 bg-paper/85 backdrop-blur-md transition-all duration-300 ease-in-out motion-reduce:transition-none ${
        hidden
          ? "pointer-events-none -translate-y-full opacity-0"
          : "translate-y-0 opacity-100"
      }`}
      data-global-sticky-header
      data-header-hidden={hidden}
      ref={wrapperRef}
    >
      {children}
    </div>
  );
}
