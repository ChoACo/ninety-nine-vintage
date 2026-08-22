export function ChartSkeleton() {
  return <div className="relative h-72 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900" role="status" aria-label="차트 불러오는 중"><div className="absolute inset-4 grid grid-rows-4 gap-8">{Array.from({ length: 4 }, (_, index) => <span className="border-t border-zinc-800" key={index} />)}</div><div className="absolute inset-y-0 w-1/3 animate-pulse bg-gradient-to-r from-transparent via-zinc-700/20 to-transparent" /></div>;
}

export function OwnerMetricSkeleton() {
  return <div className="grid gap-px border border-zinc-800 bg-zinc-800 sm:grid-cols-2 xl:grid-cols-4" role="status" aria-label="핵심 지표 불러오는 중">{Array.from({ length: 4 }, (_, index) => <div className="h-36 animate-pulse bg-zinc-950 p-6" key={index}><div className="h-3 w-24 rounded bg-zinc-800" /><div className="mt-10 h-8 w-36 rounded bg-zinc-800" /></div>)}</div>;
}

export function OwnerTableSkeleton() {
  return <div className="overflow-hidden rounded-2xl border border-zinc-800" role="status" aria-label="목록 불러오는 중"><div className="grid h-12 grid-cols-4 gap-4 bg-zinc-900 px-4">{Array.from({ length: 4 }, (_, index) => <span className="my-auto h-3 animate-pulse rounded bg-zinc-700" key={index} />)}</div>{Array.from({ length: 8 }, (_, index) => <div className="grid h-14 grid-cols-4 gap-4 border-t border-zinc-800 px-4" key={index}>{Array.from({ length: 4 }, (_, cell) => <span className="my-auto h-3 animate-pulse rounded bg-zinc-800" key={cell} />)}</div>)}</div>;
}
