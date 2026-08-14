import Link from "next/link";
import { getKstDateKey, getRecentCatalogDates } from "@/lib/catalogDate";

export function StoreMallDateNav({ basePath = "", slug, selectedDate }: { basePath?: "" | "/m"; slug: string; selectedDate: string }) {
  const today = getKstDateKey();
  return <nav aria-label="상품 등록 날짜" className="mt-6 flex gap-2 overflow-x-auto pb-2">
    {getRecentCatalogDates().map((date) => <Link
      aria-current={date === selectedDate ? "date" : undefined}
      className={`shrink-0 rounded-full border px-4 py-2 text-xs font-bold ${date === selectedDate ? "border-ink bg-ink text-paper" : "border-line bg-paper"}`}
      href={`${basePath}/stores/${encodeURIComponent(slug)}?date=${date}`}
      key={date}
      prefetch={false}
    >{date === today ? "오늘" : date.slice(5).replace("-", ".")}</Link>)}
  </nav>;
}
