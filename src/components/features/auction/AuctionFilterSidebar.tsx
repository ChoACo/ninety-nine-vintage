"use client";

import { RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";

const sizes = ["S", "M", "L", "XL", "FREE"];
const categories = ["구제 의류"];
type Sort = "latest" | "ending" | "price_asc" | "price_desc";
interface CatalogFilters { sizes: string[]; categories: string[]; liveOnly: boolean; closingOnly: boolean; sort: Sort; }

export function AuctionFilterSidebar({ saleType = "auction" }: { saleType?: "auction" | "fixed" }) {
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [liveOnly, setLiveOnly] = useState(true);
  const [closingOnly, setClosingOnly] = useState(false);
  const [selectedSort, setSelectedSort] = useState<Sort>(saleType === "fixed" ? "latest" : "ending");
  const [mobileOpen, setMobileOpen] = useState(false);
  const notify = (next: CatalogFilters) => window.dispatchEvent(new CustomEvent<CatalogFilters>("catalog-filters", { detail: next }));

  const resetFilters = () => {
    const nextSort = saleType === "fixed" ? "latest" : "ending";
    setSelectedSizes([]); setSelectedCategories([]); setLiveOnly(true); setClosingOnly(false); setSelectedSort(nextSort);
    notify({ sizes: [], categories: [], liveOnly: true, closingOnly: false, sort: nextSort });
  };

  const sortOptions: Array<[string, Sort]> = saleType === "fixed"
    ? [["최신 등록순", "latest"], ["가격 높은순", "price_desc"], ["가격 낮은순", "price_asc"]]
    : [["마감 임박순", "ending"], ["최신 등록순", "latest"], ["현재 입찰가 높은순", "price_desc"], ["현재 입찰가 낮은순", "price_asc"]];

  const filterContent = (
    <>
      <div className="flex items-center justify-between border-b border-zinc-200 py-4">
        <h2 className="text-xs font-bold tracking-[0.12em]">FILTER &amp; SORT <span className="font-normal text-muted lg:hidden">· 모바일 필터</span></h2>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-1 text-[11px] text-zinc-500 transition-colors hover:text-zinc-950" onClick={resetFilters} type="button"><RotateCcw size={12} /> 초기화</button>
          <button aria-label="모바일 필터 닫기" className="lg:hidden" onClick={() => setMobileOpen(false)} type="button"><X size={18} /></button>
        </div>
      </div>

      <section className="border-b border-zinc-200 py-5">
        <h3 className="mb-4 text-xs font-bold">정렬</h3>
        <div className="space-y-3 text-xs text-zinc-600">
          {sortOptions.map(([label, value]) => (
            <label className="flex cursor-pointer items-center gap-2 hover:text-zinc-950" key={label}>
              <input checked={selectedSort === value} className="accent-zinc-950" name={`sort-${saleType}`} onChange={() => { const nextSort = value as Sort; setSelectedSort(nextSort); notify({ sizes: selectedSizes, categories: selectedCategories, liveOnly, closingOnly, sort: nextSort }); }} type="radio" />
              {label}
            </label>
          ))}
        </div>
      </section>

      <section className="border-b border-zinc-200 py-5">
        <h3 className="mb-4 text-xs font-bold">사이즈</h3>
        <div className="grid grid-cols-5 gap-1.5">
          {sizes.map((size) => {
            const selected = selectedSizes.includes(size);
            return <button className={`h-8 border text-[11px] transition-colors ${selected ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-950 hover:text-zinc-950"}`} key={size} onClick={() => { const next = selected ? selectedSizes.filter((item) => item !== size) : [...selectedSizes, size]; setSelectedSizes(next); notify({ sizes: next, categories: selectedCategories, liveOnly, closingOnly, sort: selectedSort }); }} type="button">{size}</button>;
          })}
        </div>
      </section>

      <section className="border-b border-zinc-200 py-5">
        <h3 className="mb-4 text-xs font-bold">카테고리</h3>
        <div className="space-y-3 text-xs text-zinc-600">
          {categories.map((category) => <label className="flex cursor-pointer items-center gap-2 hover:text-zinc-950" key={category}><input checked={selectedCategories.includes(category)} className="accent-zinc-950" onChange={() => { const next = selectedCategories.includes(category) ? selectedCategories.filter((item) => item !== category) : [...selectedCategories, category]; setSelectedCategories(next); notify({ sizes: selectedSizes, categories: next, liveOnly, closingOnly, sort: selectedSort }); }} type="checkbox" />{category}</label>)}
        </div>
      </section>

      {saleType === "auction" && <section className="py-5">
        <h3 className="mb-4 text-xs font-bold">경매 상태</h3>
        <div className="space-y-3 text-xs text-zinc-600">
          <label className="flex cursor-pointer items-center gap-2 hover:text-zinc-950"><input checked={liveOnly} className="accent-zinc-950" onChange={(event) => { setLiveOnly(event.target.checked); notify({ sizes: selectedSizes, categories: selectedCategories, liveOnly: event.target.checked, closingOnly, sort: selectedSort }); }} type="checkbox" /><span className="text-emerald-500">●</span> LIVE DROP (진행중)</label>
          <label className="flex cursor-pointer items-center gap-2 hover:text-zinc-950"><input checked={closingOnly} className="accent-zinc-950" onChange={(event) => { setClosingOnly(event.target.checked); notify({ sizes: selectedSizes, categories: selectedCategories, liveOnly, closingOnly: event.target.checked, sort: selectedSort }); }} type="checkbox" /><span className="text-amber-500">●</span> CLOSING SOON (마감 임박)</label>
        </div>
      </section>}
    </>
  );

  return (
    <>
      <button aria-expanded={mobileOpen} className="mb-4 flex h-12 w-full items-center justify-between border-y border-zinc-950 px-1 text-xs font-bold lg:hidden" onClick={() => setMobileOpen(true)} type="button"><span className="flex items-center gap-2"><SlidersHorizontal size={15} /> FILTER &amp; SORT</span><span className="text-[10px] text-muted">{selectedSizes.length + selectedCategories.length}개 선택</span></button>
      <aside className="hidden w-full flex-shrink-0 self-start border-t border-zinc-950 lg:sticky lg:top-[100px] lg:block lg:w-[240px]">{filterContent}</aside>
      {mobileOpen && <div aria-label="모바일 필터 바텀시트" aria-modal="true" className="fixed inset-0 z-[70] bg-ink/40 lg:hidden" role="dialog" onClick={() => setMobileOpen(false)}><aside className="absolute inset-x-0 bottom-0 max-h-[86vh] overflow-y-auto rounded-t-2xl bg-paper px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-ink shadow-2xl" onClick={(event) => event.stopPropagation()}>{filterContent}</aside></div>}
    </>
  );
}
