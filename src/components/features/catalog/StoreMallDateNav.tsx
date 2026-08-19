import Link from "next/link";
import { getKstDateKey } from "@/lib/catalogDate";

export function StoreMallDateNav({ basePath = "", dates, selectedDate, slug, subPath = "" }: { basePath?: "" | "/m"; dates: string[]; selectedDate: string; slug: string; subPath?: "" | "/new" | "/auction" | "/buy" }) {
  const today = getKstDateKey();
  if (dates.length === 0) return <p className="mt-3 text-sm text-muted">현재 판매 중인 상품이 없어 등록일이 표시되지 않습니다.</p>;
  return <nav aria-label="상품이 등록된 날짜" className="mt-5 flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none]">
    {dates.map((date) => <Link
      aria-current={date === selectedDate ? "date" : undefined}
      className={`shrink-0 rounded-full border px-4 py-2 text-xs font-bold ${date === selectedDate ? "border-ink bg-ink text-paper" : "border-line bg-paper"}`}
      href={`${basePath}/stores/${encodeURIComponent(slug)}${subPath}?date=${date}`}
      key={date}
      prefetch={false}
    ><span className="block text-[10px] font-medium opacity-60">{date === today ? "TODAY" : date.slice(0, 4)}</span><span className="mt-0.5 block">{date === today ? "오늘" : date.slice(5).replace("-", ".")}</span></Link>)}
  </nav>;
}
