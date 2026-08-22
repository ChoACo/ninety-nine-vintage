import Link from "next/link";

const categories = [["전체", ""], ["아우터", "outer"], ["상의", "top"], ["하의", "bottom"], ["가방/신발", "bag"], ["액세서리", "accessory"]] as const;
const grades = [["Grade S", "S"], ["Grade A", "A"], ["Grade B", "B"]] as const;

export function HomeCategoryFilters({ basePath = "" }: { basePath?: "" | "/m" }) {
  return <nav aria-label="즉시 구매 빠른 필터" className="mb-7 space-y-3"><div className="flex gap-2 overflow-x-auto pb-1">{categories.map(([label, value]) => <Link className="inline-flex min-h-10 shrink-0 items-center rounded-full border border-line bg-surface px-4 text-xs font-bold transition-colors hover:border-amber-500 hover:text-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500" href={`${basePath}/shop${value ? `?category=${value}` : ""}`} key={label}>{label}</Link>)}</div><div className="flex gap-2 overflow-x-auto pb-1">{grades.map(([label, value]) => <Link className="inline-flex min-h-9 shrink-0 items-center rounded-full border border-zinc-700 px-3 font-mono text-[10px] font-bold text-muted transition-colors hover:border-emerald-500 hover:text-emerald-500" href={`${basePath}/shop?grade=${value}`} key={value}>{label}{value === "S" ? " · 미사용급" : value === "A" ? " · 우수" : " · 빈티지감"}</Link>)}</div></nav>;
}
