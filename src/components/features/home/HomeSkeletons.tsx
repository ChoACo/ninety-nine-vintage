function Pulse({ className }: { className: string }) {
  return (
    <div className={`animate-pulse rounded-xl bg-zinc-800/50 ${className}`} />
  );
}
export function HeroSkeleton() {
  return (
    <div
      className="grid min-h-[560px] gap-px overflow-hidden rounded-3xl bg-zinc-800 sm:grid-cols-2"
      role="status"
      aria-label="홈 배너 불러오는 중"
    >
      <div className="space-y-6 bg-zinc-950 p-8 md:p-16">
        <Pulse className="h-3 w-28" />
        <Pulse className="mt-24 h-24 w-4/5" />
        <Pulse className="h-12 w-3/5" />
      </div>
      <Pulse className="min-h-[480px] rounded-none" />
    </div>
  );
}
export function AuctionCardSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="경매 상품 불러오는 중">
      <Pulse className="aspect-[4/5] w-full" />
      <Pulse className="h-4 w-4/5" />
      <Pulse className="h-4 w-2/5" />
    </div>
  );
}
export function ProductGridSkeleton() {
  return (
    <div
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-3 md:gap-6 lg:grid-cols-4"
      role="status"
      aria-label="상품 목록 불러오는 중"
    >
      {Array.from({ length: 8 }, (_, index) => (
        <AuctionCardSkeleton key={index} />
      ))}
    </div>
  );
}
