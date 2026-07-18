"use client";

import { type ReactNode, useId, useState } from "react";

export interface CollapsibleSectionProps {
  id?: string;
  title: string;
  eyebrow: string;
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
  actions?: ReactNode;
  className?: string;
}

/**
 * 운영 센터의 각 업무를 서로 독립적으로 펼치는 접근성 친화 섹션입니다.
 * 처음 펼치기 전에는 무거운 본문을 마운트하지 않습니다. 한 번 펼친 내용은
 * 다시 접어도 DOM에 남겨 두어 입력값과 스크롤 문맥을 잃지 않습니다.
 */
export function CollapsibleSection({
  id,
  title,
  eyebrow,
  summary,
  children,
  defaultOpen = false,
  actions,
  className = "",
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [hasBeenOpened, setHasBeenOpened] = useState(defaultOpen);
  const generatedId = useId();
  const contentId = `${generatedId}-content`;
  const buttonId = `${generatedId}-button`;

  const toggleSection = () => {
    if (!isOpen) setHasBeenOpened(true);
    setIsOpen((current) => !current);
  };

  return (
    <section
      id={id}
      className={`scroll-mt-24 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-[0_8px_30px_rgba(35,28,23,0.06)] transition-all duration-200 ease-out hover:border-[var(--border-strong)] ${className}`}
    >
      <div className="relative flex items-start gap-3 px-4 py-3.5 sm:px-5 sm:py-4">
        <span
          aria-hidden="true"
          className={`absolute inset-y-3 left-0 w-0.5 rounded-r-full bg-[var(--accent)] transition-opacity duration-200 ${
            isOpen ? "opacity-100" : "opacity-0"
          }`}
        />
        <button
          id={buttonId}
          type="button"
          aria-expanded={isOpen}
          aria-controls={contentId}
          onClick={toggleSection}
          className="group flex min-w-0 flex-1 items-center justify-between gap-4 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-raised)]"
        >
          <span className="min-w-0">
            <span className="block text-[10px] font-black uppercase tracking-[0.18em] text-[var(--accent-text)]">
              {eyebrow}
            </span>
            <span className="mt-0.5 block text-[17px] font-black tracking-[-0.02em] text-[var(--text-strong)] sm:text-lg">
              {title}
            </span>
            <span className="mt-1 block max-w-4xl text-xs font-semibold leading-5 text-[var(--text-muted)] sm:text-sm">
              {summary}
            </span>
          </span>
          <span
            aria-hidden="true"
            className={`grid size-8 shrink-0 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-muted)] transition-all duration-200 ease-out group-hover:border-[var(--border-strong)] group-hover:text-[var(--text-strong)] ${
              isOpen ? "rotate-180" : ""
            }`}
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="size-4"
            >
              <path d="m5 7.5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>

        {actions ? (
          <div className="hidden shrink-0 sm:block">{actions}</div>
        ) : null}
      </div>

      <div
        id={contentId}
        role="region"
        aria-labelledby={buttonId}
        aria-hidden={!isOpen}
        inert={!isOpen}
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        {hasBeenOpened ? (
          <div className="min-h-0 overflow-hidden">
            <div
              className={`border-t border-[var(--border)] px-4 py-4 transition-opacity duration-200 sm:px-5 sm:py-5 ${
                isOpen ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              {actions ? <div className="mb-4 sm:hidden">{actions}</div> : null}
              {children}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
