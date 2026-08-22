export function SalesSkeleton() {
  return <div aria-label="매출 분석 로딩 중" className="space-y-6" role="status">
    <div className="h-24 animate-pulse rounded-2xl bg-zinc-900" />
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div className="h-36 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900" key={index} />)}</div>
    <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">{Array.from({ length: 2 }, (_, index) => <div className="h-[370px] animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900" key={index} />)}</div>
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900"><div className="h-16 border-b border-zinc-800" />{Array.from({ length: 6 }, (_, index) => <div className="h-16 animate-pulse border-b border-zinc-800 bg-zinc-900/70" key={index} />)}</div>
  </div>;
}
