"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";

const sizes = ["S", "M", "L", "XL", "FREE"];
const categories = ["Outer", "Top", "Bottom", "Acc"];

export function AuctionFilterSidebar() {
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [liveOnly, setLiveOnly] = useState(true);
  const [closingOnly, setClosingOnly] = useState(false);

  const toggleValue = (
    value: string,
    values: string[],
    setValues: (next: string[]) => void,
  ) => {
    setValues(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  };

  const resetFilters = () => {
    setSelectedSizes([]);
    setSelectedCategories([]);
    setLiveOnly(true);
    setClosingOnly(false);
  };

  return (
    <aside className="sticky top-[100px] w-[240px] flex-shrink-0 self-start border-t border-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-200 py-4">
        <h2 className="text-xs font-bold tracking-[0.12em]">FILTER &amp; SORT</h2>
        <button className="flex items-center gap-1 text-[11px] text-zinc-500 transition-colors hover:text-zinc-950" onClick={resetFilters} type="button">
          <RotateCcw size={12} /> 초기화
        </button>
      </div>

      <section className="border-b border-zinc-200 py-5">
        <h3 className="mb-4 text-xs font-bold">정렬</h3>
        <div className="space-y-3 text-xs text-zinc-600">
          {["마감 임박순", "최신 등록순", "현재 입찰가 높은순", "현재 입찰가 낮은순"].map((label, index) => (
            <label className="flex cursor-pointer items-center gap-2 hover:text-zinc-950" key={label}>
              <input className="accent-zinc-950" defaultChecked={index === 0} name="sort" type="radio" />
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
            return (
              <button className={`h-8 border text-[11px] transition-colors ${selected ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-950 hover:text-zinc-950"}`} key={size} onClick={() => toggleValue(size, selectedSizes, setSelectedSizes)} type="button">
                {size}
              </button>
            );
          })}
        </div>
      </section>

      <section className="border-b border-zinc-200 py-5">
        <h3 className="mb-4 text-xs font-bold">카테고리</h3>
        <div className="space-y-3 text-xs text-zinc-600">
          {categories.map((category) => (
            <label className="flex cursor-pointer items-center gap-2 hover:text-zinc-950" key={category}>
              <input checked={selectedCategories.includes(category)} className="accent-zinc-950" onChange={() => toggleValue(category, selectedCategories, setSelectedCategories)} type="checkbox" />
              {category}
            </label>
          ))}
        </div>
      </section>

      <section className="py-5">
        <h3 className="mb-4 text-xs font-bold">경매 상태</h3>
        <div className="space-y-3 text-xs text-zinc-600">
          <label className="flex cursor-pointer items-center gap-2 hover:text-zinc-950">
            <input checked={liveOnly} className="accent-zinc-950" onChange={(event) => setLiveOnly(event.target.checked)} type="checkbox" />
            <span className="text-emerald-500">●</span> LIVE DROP (진행중)
          </label>
          <label className="flex cursor-pointer items-center gap-2 hover:text-zinc-950">
            <input checked={closingOnly} className="accent-zinc-950" onChange={(event) => setClosingOnly(event.target.checked)} type="checkbox" />
            <span className="text-amber-500">●</span> CLOSING SOON (마감 임박)
          </label>
        </div>
      </section>
    </aside>
  );
}
