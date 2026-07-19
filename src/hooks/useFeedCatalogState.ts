"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { CatalogSize, CatalogSort } from "@/src/utils/catalogFilters";

const STORAGE_KEY = "nnv:feed-catalog:v1:/feed";
const MAX_VISIBLE_ITEMS = 2_000;
const MAX_QUERY_LENGTH = 80;

interface FeedCatalogValues {
  query: string;
  selectedDate: string;
  sort: CatalogSort;
  size: CatalogSize;
  visibleCount: number;
}

interface SavedFeedCatalogState extends FeedCatalogValues {
  scrollY: number;
  anchorId: string;
  anchorViewportTop: number;
  feedHeight: number;
}

interface UseFeedCatalogStateOptions {
  initialVisibleCount: number;
  visibleStep: number;
  loadedProductCount: number;
  isLoading: boolean;
  hasMoreProducts: boolean;
  isLoadingMore: boolean;
  onLoadMore?: () => void | Promise<void>;
}

interface UseFeedCatalogStateResult extends FeedCatalogValues {
  isHydrated: boolean;
  showTopButton: boolean;
  restorationMinHeight: number;
  feedRootRef: RefObject<HTMLElement | null>;
  setQuery: (query: string) => void;
  setSelectedDate: (date: string) => void;
  setSort: (sort: CatalogSort) => void;
  setSize: (size: CatalogSize) => void;
  showMore: () => void;
  resetCatalog: () => void;
  scrollToTop: () => void;
}

const validSorts = new Set<CatalogSort>([
  "latest",
  "closing",
  "price-desc",
  "price-asc",
]);
const validSizes = new Set<CatalogSize>(["all", "S", "M", "L", "XL"]);
const DATE_FILTER_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;

function normalizeDateFilter(value: unknown, fallback = "all"): string {
  if (value === "all") return "all";
  return typeof value === "string" && DATE_FILTER_PATTERN.test(value)
    ? value
    : fallback;
}

function clampVisibleCount(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numeric)) return fallback;
  return Math.min(Math.max(numeric, fallback), MAX_VISIBLE_ITEMS);
}

function readSavedState(initialVisibleCount: number): SavedFeedCatalogState | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null") as
      | Partial<SavedFeedCatalogState>
      | null;
    if (!parsed || typeof parsed !== "object") return null;

    return {
      query:
        typeof parsed.query === "string"
          ? parsed.query.slice(0, MAX_QUERY_LENGTH)
          : "",
      selectedDate: normalizeDateFilter(parsed.selectedDate),
      sort: validSorts.has(parsed.sort as CatalogSort)
        ? (parsed.sort as CatalogSort)
        : "latest",
      size: validSizes.has(parsed.size as CatalogSize)
        ? (parsed.size as CatalogSize)
        : "all",
      visibleCount: clampVisibleCount(parsed.visibleCount, initialVisibleCount),
      scrollY:
        typeof parsed.scrollY === "number" &&
        Number.isFinite(parsed.scrollY) &&
        parsed.scrollY > 0
          ? parsed.scrollY
          : 0,
      anchorId:
        typeof parsed.anchorId === "string"
          ? parsed.anchorId.slice(0, 128)
          : "",
      anchorViewportTop:
        typeof parsed.anchorViewportTop === "number" &&
        Number.isFinite(parsed.anchorViewportTop)
          ? parsed.anchorViewportTop
          : 0,
      feedHeight:
        typeof parsed.feedHeight === "number" &&
        Number.isFinite(parsed.feedHeight) &&
        parsed.feedHeight > 0
          ? Math.min(parsed.feedHeight, 200_000)
          : 0,
    };
  } catch {
    return null;
  }
}

function getCardAtViewport(): HTMLElement | null {
  let closestCard: HTMLElement | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  document
    .querySelectorAll<HTMLElement>("[data-feed-product-id]")
    .forEach((card) => {
      const rect = card.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) return;
      const distance = Math.abs(rect.top - 180);
      if (distance >= closestDistance) return;
      closestDistance = distance;
      closestCard = card;
    });
  return closestCard;
}

function findFeedCard(productId: string | null): HTMLElement | null {
  if (!productId || productId.length > 128) return null;
  return (
    Array.from(
      document.querySelectorAll<HTMLElement>("[data-feed-product-id]"),
    ).find((element) => element.dataset.feedProductId === productId) ?? null
  );
}

export function useFeedCatalogState({
  initialVisibleCount,
  visibleStep,
  loadedProductCount,
  isLoading,
  hasMoreProducts,
  isLoadingMore,
  onLoadMore,
}: UseFeedCatalogStateOptions): UseFeedCatalogStateResult {
  const [values, setValues] = useState<FeedCatalogValues>({
    query: "",
    selectedDate: "all",
    sort: "latest",
    size: "all",
    visibleCount: initialVisibleCount,
  });
  const [isHydrated, setIsHydrated] = useState(false);
  const [showTopButton, setShowTopButton] = useState(false);
  const [restorationMinHeight, setRestorationMinHeight] = useState(0);
  const feedRootRef = useRef<HTMLElement>(null);
  const valuesRef = useRef(values);
  const savedRef = useRef<SavedFeedCatalogState | null>(null);
  const restoreCompleteRef = useRef(false);
  const loadAttemptCountRef = useRef(-1);

  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  useEffect(() => {
    if (isLoading) loadAttemptCountRef.current = -1;
  }, [isLoading]);

  useEffect(() => {
    const saved = readSavedState(initialVisibleCount);
    const params = new URL(window.location.href).searchParams;
    const urlSort = params.get("sort") as CatalogSort | null;
    const urlSize = params.get("size") as CatalogSize | null;
    const urlDate = params.get("date");
    const urlQuery = params.get("q");
    const resolvedUrlDate = params.has("date")
      ? normalizeDateFilter(urlDate)
      : null;
    const positionMatchesUrl =
      !params.has("focus") &&
      (!params.has("q") || urlQuery === saved?.query) &&
      (!params.has("date") || resolvedUrlDate === saved?.selectedDate) &&
      (!params.has("sort") || urlSort === saved?.sort) &&
      (!params.has("size") || urlSize === saved?.size);
    const restorablePosition = positionMatchesUrl ? saved : null;
    const restored: FeedCatalogValues = {
      query: (urlQuery ?? saved?.query ?? "").slice(0, MAX_QUERY_LENGTH),
      selectedDate: resolvedUrlDate ?? saved?.selectedDate ?? "all",
      sort: urlSort && validSorts.has(urlSort) ? urlSort : saved?.sort ?? "latest",
      size: urlSize && validSizes.has(urlSize) ? urlSize : saved?.size ?? "all",
      visibleCount: restorablePosition?.visibleCount ?? initialVisibleCount,
    };

    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    savedRef.current = restorablePosition;
    restoreCompleteRef.current = false;
    const hydrationTimer = window.setTimeout(() => {
      setValues(restored);
      setRestorationMinHeight(restorablePosition?.feedHeight ?? 0);
      setShowTopButton((restorablePosition?.scrollY ?? 0) > 640);
      setIsHydrated(true);
    }, 0);
    return () => {
      window.clearTimeout(hydrationTimer);
      window.history.scrollRestoration = previousRestoration;
    };
  }, [initialVisibleCount]);

  const persistPosition = useCallback((includeAnchor: boolean) => {
    if (!isHydrated || !restoreCompleteRef.current) return;
    const anchor = includeAnchor ? getCardAtViewport() : null;
    const previous = savedRef.current;
    const next: SavedFeedCatalogState = {
      ...valuesRef.current,
      scrollY: Math.max(window.scrollY, 0),
      anchorId: anchor?.dataset.feedProductId ?? previous?.anchorId ?? "",
      anchorViewportTop: anchor?.getBoundingClientRect().top ?? previous?.anchorViewportTop ?? 0,
      feedHeight: feedRootRef.current?.scrollHeight ?? previous?.feedHeight ?? 0,
    };
    savedRef.current = next;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage can be unavailable in private browsing. URL filters still work.
    }
  }, [isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    const url = new URL(window.location.href);
    const setOrDelete = (key: string, value: string, defaultValue: string) => {
      if (value === defaultValue) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    };
    setOrDelete("q", values.query.trim(), "");
    setOrDelete("date", values.selectedDate, "all");
    setOrDelete("sort", values.sort, "latest");
    setOrDelete("size", values.size, "all");
    window.history.replaceState(window.history.state, "", url);
    persistPosition(false);
  }, [isHydrated, persistPosition, values]);

  useEffect(() => {
    if (!isHydrated) return;
    let frame = 0;
    let saveTimer = 0;
    const handleScroll = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          setShowTopButton(window.scrollY > 640);
        });
      }
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => persistPosition(true), 180);
    };
    const handlePageHide = () => persistPosition(true);
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") persistPosition(true);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(saveTimer);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibility);
      persistPosition(true);
    };
  }, [isHydrated, persistPosition]);

  useEffect(() => {
    if (!isHydrated || isLoading || isLoadingMore || !onLoadMore) return;
    const focusId = new URL(window.location.href).searchParams.get("focus");
    const needsFocusedProduct =
      Boolean(focusId) &&
      !findFeedCard(focusId);
    const savedAnchorId = savedRef.current?.anchorId ?? "";
    const needsSavedAnchor =
      !restoreCompleteRef.current &&
      Boolean(savedAnchorId) &&
      !findFeedCard(savedAnchorId);
    const needsRestoredItems = values.visibleCount > loadedProductCount;

    if (
      (needsFocusedProduct || needsSavedAnchor || needsRestoredItems) &&
      hasMoreProducts
    ) {
      if (loadAttemptCountRef.current === loadedProductCount) return;
      loadAttemptCountRef.current = loadedProductCount;
      void onLoadMore();
      return;
    }

    if (restoreCompleteRef.current) return;
    const saved = savedRef.current;
    let innerFrame = 0;
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => {
        const previousBehavior = document.documentElement.style.scrollBehavior;
        try {
          document.documentElement.style.scrollBehavior = "auto";
          const focused = findFeedCard(focusId);
          if (focused) {
            focused.scrollIntoView({ block: "center", behavior: "auto" });
          } else if (saved?.anchorId) {
            window.scrollTo({ top: saved.scrollY, behavior: "auto" });
            const anchor = findFeedCard(saved.anchorId);
            if (anchor) {
              window.scrollBy({
                top: anchor.getBoundingClientRect().top - saved.anchorViewportTop,
                behavior: "auto",
              });
            }
          } else if (saved?.scrollY) {
            window.scrollTo({ top: saved.scrollY, behavior: "auto" });
          }
        } finally {
          document.documentElement.style.scrollBehavior = previousBehavior;
          restoreCompleteRef.current = true;
          setRestorationMinHeight(0);
        }
      });
    });
    return () => {
      window.cancelAnimationFrame(outerFrame);
      window.cancelAnimationFrame(innerFrame);
    };
  }, [
    hasMoreProducts,
    isHydrated,
    isLoading,
    isLoadingMore,
    loadedProductCount,
    onLoadMore,
    values.visibleCount,
  ]);

  const updateRefinement = useCallback(
    (patch: Partial<Omit<FeedCatalogValues, "visibleCount">>) => {
      setValues((current) => {
        const changed = Object.entries(patch).some(
          ([key, value]) => current[key as keyof FeedCatalogValues] !== value,
        );
        if (!changed) return current;
        return {
          ...current,
          ...patch,
          visibleCount: initialVisibleCount,
        };
      });
    },
    [initialVisibleCount],
  );

  const scrollToTop = useCallback(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }, []);

  return {
    ...values,
    isHydrated,
    showTopButton,
    restorationMinHeight,
    feedRootRef,
    setQuery: (query) => updateRefinement({ query: query.slice(0, MAX_QUERY_LENGTH) }),
    setSelectedDate: (selectedDate) => updateRefinement({ selectedDate }),
    setSort: (sort) => updateRefinement({ sort }),
    setSize: (size) => updateRefinement({ size }),
    showMore: () =>
      setValues((current) => ({
        ...current,
        visibleCount: Math.min(
          current.visibleCount + visibleStep,
          MAX_VISIBLE_ITEMS,
        ),
      })),
    resetCatalog: () =>
      setValues({
        query: "",
        selectedDate: "all",
        sort: "latest",
        size: "all",
        visibleCount: initialVisibleCount,
      }),
    scrollToTop,
  };
}
