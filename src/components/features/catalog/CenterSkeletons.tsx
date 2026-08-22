function Pulse({ className }: { className: string }) {
  return (
    <div className={`animate-pulse rounded-xl bg-zinc-800/60 ${className}`} />
  );
}
export function CenterCardSkeleton() {
  return (
    <article className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900">
      <Pulse className="aspect-[16/10] rounded-none" />
      <div className="space-y-4 p-4">
        <Pulse className="-mt-10 size-11 rounded-full" />
        <Pulse className="h-5 w-1/2" />
        <Pulse className="h-4 w-full" />
        <Pulse className="h-11 w-full" />
      </div>
    </article>
  );
}
export function CenterGridSkeleton() {
  return (
    <div
      className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4 lg:gap-5"
      role="status"
      aria-label="센터 목록 불러오는 중"
    >
      {Array.from({ length: 8 }, (_, index) => (
        <CenterCardSkeleton key={index} />
      ))}
    </div>
  );
}
export function CenterDetailSkeleton() {
  return (
    <div className="space-y-7" role="status" aria-label="센터 상세 불러오는 중">
      <Pulse className="h-[420px] w-full" />
      <div className="flex gap-3">
        {Array.from({ length: 5 }, (_, index) => (
          <Pulse className="h-11 w-28" key={index} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Pulse className="aspect-[4/5]" key={index} />
        ))}
      </div>
    </div>
  );
}
