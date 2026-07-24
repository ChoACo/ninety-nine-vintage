"use client";

import { RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useState } from "react";

import { PremiumDialog } from "@/components/ui/PremiumDialog";

const genders = ["all", "남성", "여성", "공용"] as const;

type CatalogGender = (typeof genders)[number];
type Sort = "latest" | "ending" | "price_asc" | "price_desc";

interface CatalogFilters {
  brand?: string;
  categories: string[];
  closingOnly: boolean;
  date?: string;
  gender?: CatalogGender;
  liveOnly: boolean;
  query?: string;
  sizes: string[];
  sort: Sort;
}

interface CatalogFilterOptions {
  brands?: string[];
  dates?: string[];
}

function readInitialParam(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return new URLSearchParams(window.location.search).get(name)?.trim() ||
    fallback;
}

function dateFilterLabel(dateKey: string) {
  const [, month, day] = dateKey.split("-");
  return `${Number(month)}월 ${Number(day)}일`;
}

export function AuctionFilterSidebar({
  saleType = "auction",
  surface = "mobile",
}: {
  saleType?: "auction" | "fixed";
  surface?: "desktop" | "mobile";
}) {
  const [query, setQuery] = useState(() => readInitialParam("q", ""));
  const [selectedBrand, setSelectedBrand] = useState(() =>
    readInitialParam("brand", "all")
  );
  const [selectedDate, setSelectedDate] = useState(() =>
    saleType === "auction" ? readInitialParam("date", "all") : "all"
  );
  const [selectedGender, setSelectedGender] = useState<CatalogGender>(() => {
    const initial = readInitialParam("gender", "all");
    return genders.includes(initial as CatalogGender)
      ? initial as CatalogGender
      : "all";
  });
  const [brandOptions, setBrandOptions] = useState<string[]>(["all"]);
  const [dateOptions, setDateOptions] = useState<string[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeAtDesktop = () => {
      if (desktop.matches) setMobileOpen(false);
    };
    closeAtDesktop();
    desktop.addEventListener("change", closeAtDesktop);
    return () => desktop.removeEventListener("change", closeAtDesktop);
  }, []);

  useEffect(() => {
    const receiveOptions = (event: Event) => {
      const detail = (event as CustomEvent<CatalogFilterOptions>).detail;
      if (Array.isArray(detail?.brands)) {
        setBrandOptions(["all", ...detail.brands.filter(Boolean)]);
      }
      if (Array.isArray(detail?.dates)) {
        setDateOptions(detail.dates.filter(Boolean));
      }
    };
    window.addEventListener("catalog-filter-options", receiveOptions);
    return () =>
      window.removeEventListener("catalog-filter-options", receiveOptions);
  }, []);

  const notify = (next: CatalogFilters) =>
    window.dispatchEvent(
      new CustomEvent<CatalogFilters>("catalog-filters", { detail: next }),
    );

  const sharedFilters = (
    next: Partial<
      Pick<CatalogFilters, "brand" | "date" | "gender" | "query">
    > = {},
  ): CatalogFilters => ({
    brand: next.brand ?? selectedBrand,
    categories: [],
    closingOnly: false,
    date: saleType === "auction"
      ? next.date ?? selectedDate
      : "all",
    gender: next.gender ?? selectedGender,
    liveOnly: true,
    query: next.query ?? query,
    sizes: [],
    sort: "latest",
  });

  const resetFilters = () => {
    setQuery("");
    setSelectedBrand("all");
    setSelectedDate("all");
    setSelectedGender("all");
    notify({
      brand: "all",
      categories: [],
      closingOnly: false,
      date: "all",
      gender: "all",
      liveOnly: true,
      query: "",
      sizes: [],
      sort: "latest",
    });
  };

  const effectiveBrand = selectedBrand === "all" ||
      brandOptions.includes(selectedBrand)
    ? selectedBrand
    : "all";
  const effectiveDate = selectedDate === "all" ||
      dateOptions.includes(selectedDate)
    ? selectedDate
    : "all";

  const filterContent = (
    <>
      <div className="flex items-center justify-between border-b border-zinc-200 py-4">
        <h2 className="text-xs font-bold tracking-[0.12em]">
          필터
          {surface === "mobile" && (
            <span className="font-normal text-muted"> · 모바일</span>
          )}
        </h2>
        <div className="flex items-center gap-3">
          <button
            className="flex items-center gap-1 text-[11px] text-zinc-500 transition-colors hover:text-zinc-950"
            onClick={resetFilters}
            type="button"
          >
            <RotateCcw size={12} /> 초기화
          </button>
          {surface === "mobile" && (
            <button
              aria-label="모바일 필터 닫기"
              onClick={() => setMobileOpen(false)}
              type="button"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      <section className="border-b border-zinc-200 py-5">
        <h3 className="mb-3 text-xs font-bold">상품 검색</h3>
        <label className="flex h-11 items-center gap-2 border border-zinc-200 bg-white px-3 focus-within:border-zinc-950">
          <Search className="shrink-0 text-zinc-400" size={15} />
          <input
            aria-label="상품명·설명 검색"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none"
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              notify(sharedFilters({ query: nextQuery }));
            }}
            placeholder="상품명·설명 검색"
            value={query}
          />
        </label>
      </section>

      <section className="border-b border-zinc-200 py-5">
        <h3 className="mb-3 text-xs font-bold">브랜드 카테고리</h3>
        <select
          aria-label="브랜드 카테고리"
          className="h-11 w-full border border-zinc-200 bg-white px-3 text-xs font-bold outline-none focus:border-zinc-950"
          onChange={(event) => {
            const nextBrand = event.target.value;
            setSelectedBrand(nextBrand);
            notify(sharedFilters({ brand: nextBrand }));
          }}
          value={effectiveBrand}
        >
          {brandOptions.map((brand) => (
            <option key={brand} value={brand}>
              {brand === "all" ? "모든 브랜드" : brand}
            </option>
          ))}
        </select>
      </section>

      <section className={saleType === "auction"
          ? "border-b border-zinc-200 py-5"
          : "py-5"}
      >
        <h3 className="mb-3 text-xs font-bold">성별 카테고리</h3>
        <select
          aria-label="성별 카테고리"
          className="h-11 w-full border border-zinc-200 bg-white px-3 text-xs font-bold outline-none focus:border-zinc-950"
          onChange={(event) => {
            const nextGender = event.target.value as CatalogGender;
            setSelectedGender(nextGender);
            notify(sharedFilters({ gender: nextGender }));
          }}
          value={selectedGender}
        >
          {genders.map((gender) => (
            <option key={gender} value={gender}>
              {gender === "all" ? "모든 성별" : gender}
            </option>
          ))}
        </select>
      </section>

      {saleType === "auction" && (
        <section className="py-5">
          <h3 className="mb-3 text-xs font-bold">상품 등록일</h3>
          <select
            aria-label="상품 등록일"
            className="h-11 w-full border border-zinc-200 bg-white px-3 text-xs font-bold outline-none focus:border-zinc-950"
            onChange={(event) => {
              const nextDate = event.target.value;
              setSelectedDate(nextDate);
              notify(sharedFilters({ date: nextDate }));
            }}
            value={effectiveDate}
          >
            <option value="all">전체 등록일</option>
            {dateOptions.map((date) => (
              <option key={date} value={date}>
                {dateFilterLabel(date)}
              </option>
            ))}
          </select>
        </section>
      )}
    </>
  );

  const selectedCount = Number(Boolean(query.trim())) +
    Number(effectiveBrand !== "all") +
    Number(selectedGender !== "all") +
    Number(saleType === "auction" && effectiveDate !== "all");

  return (
    <>
      {surface === "desktop" ? (
        <aside className="sticky top-[100px] block w-[240px] flex-shrink-0 self-start border-t border-zinc-950">
          {filterContent}
        </aside>
      ) : (
        <>
          <button
            aria-expanded={mobileOpen}
            aria-haspopup="dialog"
            className="mb-4 flex h-12 w-full items-center justify-between rounded-2xl border border-zinc-950 px-4 text-xs font-bold shadow-sm transition-all duration-300 active:scale-95"
            onClick={() => setMobileOpen(true)}
            type="button"
          >
            <span className="flex items-center gap-2">
              <SlidersHorizontal size={15} />
              필터
            </span>
            <span className="text-[10px] text-muted">
              {selectedCount}개 선택
            </span>
          </button>
          <PremiumDialog
            ariaLabel="모바일 필터 바텀시트"
            onClose={() => setMobileOpen(false)}
            open={mobileOpen}
            panelClassName="px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            placement="sheet-bottom"
            zIndexClassName="z-[80]"
          >
            {filterContent}
          </PremiumDialog>
        </>
      )}
    </>
  );
}
