import Link from "next/link";

const CATEGORIES = [["전체",""],["아우터","아우터"],["상의","상의"],["하의","하의"],["원피스/스커트","원피스"],["가방/신발","가방"],["액세서리","액세서리"]] as const;

export function CategoryChips({ activeCategory = "", basePath = "/shop" }: { activeCategory?: string; basePath?: string }) {
  return <nav aria-label="아카이브 상품 카테고리" className="flex snap-x gap-2 overflow-x-auto pb-2">{CATEGORIES.map(([label,value])=><Link aria-current={activeCategory===value?"page":undefined} className={`min-h-11 shrink-0 snap-start rounded-full border px-4 py-3 text-xs font-black transition focus-visible:ring-2 focus-visible:ring-amber-500 ${activeCategory===value?"border-amber-500 bg-amber-500 text-zinc-950":"border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"}`} href={value?`${basePath}?category=${encodeURIComponent(value)}`:basePath} key={label}>{label}</Link>)}</nav>;
}
