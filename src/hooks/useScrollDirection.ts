"use client";

import { useEffect, useRef, useState } from "react";

export type ScrollDirection = "up" | "down";

interface ScrollDirectionState {
  direction: ScrollDirection;
  scrollY: number;
}

const MIN_SCROLL_DELTA = 8;

export function useScrollDirection(): ScrollDirectionState {
  const previousScrollY = useRef(0);
  const frame = useRef<number | null>(null);
  const [state, setState] = useState<ScrollDirectionState>({
    direction: "up",
    scrollY: 0,
  });

  useEffect(() => {
    previousScrollY.current = window.scrollY;

    const update = () => {
      frame.current = null;
      const nextScrollY = Math.max(window.scrollY, 0);
      const delta = nextScrollY - previousScrollY.current;

      if (nextScrollY < 50) {
        setState((current) =>
          current.direction === "up" && current.scrollY === nextScrollY
            ? current
            : { direction: "up", scrollY: nextScrollY },
        );
        previousScrollY.current = nextScrollY;
        return;
      }

      if (Math.abs(delta) < MIN_SCROLL_DELTA) return;

      setState({
        direction: delta > 0 ? "down" : "up",
        scrollY: nextScrollY,
      });
      previousScrollY.current = nextScrollY;
    };

    const onScroll = () => {
      if (frame.current !== null) return;
      frame.current = window.requestAnimationFrame(update);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    };
  }, []);

  return state;
}
