"use client";

import { type ReactNode, useId, useState } from "react";

export interface CollapsibleSectionProps {
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
    <section className={`overflow-hidden rounded-[1.75rem] border-2 border-[#eadfce] bg-[#fffaf4] shadow-[0_14px_40px_rgba(84,63,48,0.08)] ${className}`}>
      <div className="flex items-start gap-3 px-4 py-4 sm:px-6 sm:py-5">
        <button
          id={buttonId}
          type="button"
          aria-expanded={isOpen}
          aria-controls={contentId}
          onClick={toggleSection}
          className="group flex min-w-0 flex-1 items-start justify-between gap-4 rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-[#dc7563] focus-visible:ring-offset-4 focus-visible:ring-offset-[#fffaf4]"
        >
          <span className="min-w-0">
            <span className="block text-xs font-black tracking-[0.16em] text-[#8b7668]">
              {eyebrow}
            </span>
            <span className="mt-1 block text-xl font-black text-[#493b31] sm:text-2xl">
              {title}
            </span>
            <span className="mt-1.5 block text-sm font-semibold leading-6 text-[#7d6d62] sm:text-[15px]">
              {summary}
            </span>
          </span>
          <span
            aria-hidden="true"
            className={`mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#dfd0c3] bg-white text-xl font-black text-[#7d6455] shadow-sm transition duration-200 group-hover:border-[#d8a38f] group-hover:bg-[#fff3e8] ${
              isOpen ? "rotate-180" : ""
            }`}
          >
            ⌄
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
              className={`border-t border-[#eadfd5] px-4 py-5 transition-opacity duration-200 sm:px-6 sm:py-6 ${
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
