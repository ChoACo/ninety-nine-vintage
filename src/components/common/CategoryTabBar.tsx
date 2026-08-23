"use client";

import { ChevronDown, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { PremiumDialog } from "@/components/ui/PremiumDialog";

export interface CategoryTabItem<TValue extends string = string> {
  href?: string;
  label: string;
  value: TValue;
}

interface CategoryTabBarProps<TValue extends string = string> {
  ariaLabel: string;
  className?: string;
  items: readonly CategoryTabItem<TValue>[];
  onValueChange?: (value: TValue) => void;
  value: TValue;
}

const chipClassName = (active: boolean) =>
  `flex min-h-11 items-center justify-center rounded-full border px-4 py-2.5 text-xs font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
    active
      ? "border-amber-500 bg-amber-500 text-zinc-950"
      : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
  }`;

export function CategoryTabBar<TValue extends string>({
  ariaLabel,
  className = "",
  items,
  onValueChange,
  value,
}: CategoryTabBarProps<TValue>) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const titleId = useId();
  const selectedTabRef = useRef<HTMLAnchorElement | HTMLButtonElement | null>(
    null,
  );

  const scrollSelectedIntoView = useCallback(() => {
    selectedTabRef.current?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, []);

  useEffect(() => {
    scrollSelectedIntoView();
  }, [scrollSelectedIntoView, value]);

  const selectValue = (nextValue: TValue, closeSheet: boolean) => {
    onValueChange?.(nextValue);
    if (closeSheet) setSheetOpen(false);
    if (nextValue === value) {
      window.requestAnimationFrame(scrollSelectedIntoView);
    }
  };

  return (
    <>
      <div className={`relative min-w-0 flex-1 ${className}`.trim()}>
        <nav
          aria-label={ariaLabel}
          className="scrollbar-hide flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth pb-1 pr-12 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:pr-0"
        >
          {items.map((item) => {
            const active = item.value === value;
            if (item.href) {
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`${chipClassName(active)} shrink-0 snap-center`}
                  href={item.href}
                  key={item.value}
                  onClick={() => selectValue(item.value, false)}
                  ref={
                    active
                      ? (node) => {
                          selectedTabRef.current = node;
                        }
                      : undefined
                  }
                  scroll={false}
                >
                  {item.label}
                </Link>
              );
            }
            return (
              <button
                aria-pressed={active}
                className={`${chipClassName(active)} shrink-0 snap-center`}
                key={item.value}
                onClick={() => selectValue(item.value, false)}
                ref={
                  active
                    ? (node) => {
                        selectedTabRef.current = node;
                      }
                    : undefined
                }
                type="button"
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center bg-gradient-to-l from-background via-background/90 to-transparent pl-8 sm:hidden">
          <button
            aria-label="전체 카테고리 보기"
            className="pointer-events-auto grid min-h-11 min-w-11 place-items-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-100 shadow-lg transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            onClick={() => setSheetOpen(true)}
            type="button"
          >
            <ChevronDown aria-hidden="true" size={19} />
          </button>
        </div>
      </div>

      <PremiumDialog
        labelledBy={titleId}
        onClose={() => setSheetOpen(false)}
        open={sheetOpen}
        panelClassName="pb-[max(1rem,env(safe-area-inset-bottom))]"
        placement="sheet-bottom"
      >
        <button
          aria-label="카테고리 전체보기 닫기"
          className="flex min-h-8 w-full items-center justify-center"
          onClick={() => setSheetOpen(false)}
          type="button"
        >
          <span aria-hidden="true" className="h-1 w-10 rounded-full bg-line" />
        </button>
        <header className="flex items-center justify-between border-b border-line px-5 pb-4">
          <h2 className="text-lg font-black" id={titleId}>
            카테고리 전체보기
          </h2>
          <button
            aria-label="카테고리 전체보기 닫기"
            className="grid min-h-11 min-w-11 place-items-center rounded-full transition hover:bg-surface active:scale-95"
            onClick={() => setSheetOpen(false)}
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>
        <nav
          aria-label={`${ariaLabel} 전체보기`}
          className="grid grid-cols-3 gap-2 p-5 sm:grid-cols-4"
        >
          {items.map((item) => {
            const active = item.value === value;
            const className = `${chipClassName(active)} min-w-0 px-2 text-center break-keep`;
            if (item.href) {
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={className}
                  href={item.href}
                  key={item.value}
                  onClick={() => selectValue(item.value, true)}
                  scroll={false}
                >
                  {item.label}
                </Link>
              );
            }
            return (
              <button
                aria-pressed={active}
                className={className}
                key={item.value}
                onClick={() => selectValue(item.value, true)}
                type="button"
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      </PremiumDialog>
    </>
  );
}
