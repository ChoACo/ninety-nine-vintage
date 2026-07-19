"use client";

/* eslint-disable @next/next/no-img-element -- Supabase Storage의 사전 압축된 상품 파생 이미지를 교차 관찰 후 표시합니다. */

import { useEffect, useRef, useState } from "react";

const observedElements = new Map<Element, () => void>();
let sharedImageObserver: IntersectionObserver | null = null;

function getSharedImageObserver(): IntersectionObserver | null {
  if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
    return null;
  }

  if (!sharedImageObserver) {
    sharedImageObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const reveal = observedElements.get(entry.target);
          if (!reveal) return;
          observedElements.delete(entry.target);
          sharedImageObserver?.unobserve(entry.target);
          reveal();
        });
      },
      { rootMargin: "96px 0px", threshold: 0.01 },
    );
  }

  return sharedImageObserver;
}

export interface DeferredProductImageProps {
  src: string;
  alt: string;
  className?: string;
  wrapperClassName?: string;
  sizes?: string;
  emptyLabel?: string;
}

export default function DeferredProductImage({
  src,
  alt,
  className = "h-full w-full object-cover",
  wrapperClassName = "h-full w-full",
  sizes,
  emptyLabel = "미리보기 준비 중",
}: DeferredProductImageProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !src) return;

    const observer = getSharedImageObserver();
    if (!observer) {
      const revealTimer = window.setTimeout(() => setShouldLoad(true), 0);
      return () => window.clearTimeout(revealTimer);
    }

    observedElements.set(host, () => setShouldLoad(true));
    observer.observe(host);
    return () => {
      observedElements.delete(host);
      observer.unobserve(host);
    };
  }, [src]);

  const showPlaceholder = !src || hasFailed;

  return (
    <span
      ref={hostRef}
      className={`relative block overflow-hidden bg-[var(--surface-muted)] ${wrapperClassName}`}
    >
      {!isLoaded && !showPlaceholder ? (
        <span
          aria-hidden="true"
          className="commerce-skeleton absolute inset-0 rounded-none"
        />
      ) : null}

      {shouldLoad && src && !hasFailed ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          fetchPriority="low"
          sizes={sizes}
          onLoad={() => setIsLoaded(true)}
          onError={() => setHasFailed(true)}
          className={`${className} transition-[opacity,transform] duration-300 ease-out ${
            isLoaded ? "opacity-100" : "opacity-0"
          }`}
        />
      ) : null}

      {showPlaceholder ? (
        <span
          role={alt ? "img" : undefined}
          aria-label={alt ? `${alt} ${emptyLabel}` : undefined}
          className="absolute inset-0 grid place-items-center text-[var(--text-muted)]"
        >
          <span className="text-center">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              className="mx-auto h-7 w-7"
            >
              <path
                d="m4 16 4.5-4.5 3 3 2-2L20 19M7.5 8.5h.01M4 4h16v16H4V4Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="mt-1 block text-[9px] font-bold">{emptyLabel}</span>
          </span>
        </span>
      ) : null}
    </span>
  );
}
