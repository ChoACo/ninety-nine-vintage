function Pulse({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-2xl bg-zinc-800 ${className}`}
    />
  );
}
export function AuctionTimelineSkeleton() {
  return (
    <div
      aria-label="옥션 타임라인 불러오는 중"
      className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6"
    >
      <Pulse className="h-8 w-52" />
      <div className="mt-6 grid gap-2 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Pulse className="h-20" key={i} />
        ))}
      </div>
    </div>
  );
}
export function AuctionGridSkeleton() {
  return (
    <div
      aria-label="옥션 상품 불러오는 중"
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-3 md:gap-6 lg:grid-cols-4"
    >
      {Array.from({ length: 8 }, (_, i) => (
        <div className="space-y-3" key={i}>
          <Pulse className="aspect-[3/4]" />
          <Pulse className="h-4 w-3/4" />
          <Pulse className="h-5 w-1/2" />
        </div>
      ))}
    </div>
  );
}
export function BiddingDeckSkeleton() {
  return (
    <div
      aria-label="입찰 상세 불러오는 중"
      className="grid gap-8 md:grid-cols-2"
    >
      <Pulse className="aspect-[3/4]" />
      <div className="space-y-4">
        <Pulse className="h-10 w-3/4" />
        <Pulse className="h-28" />
        <Pulse className="h-14" />
        <Pulse className="h-48" />
      </div>
    </div>
  );
}
