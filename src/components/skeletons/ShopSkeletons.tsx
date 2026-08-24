function Pulse({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={`skeleton-shimmer rounded-2xl bg-zinc-800 ${className}`}
    />
  );
}
export function ShopCatalogSkeleton({
  surface = "desktop",
}: {
  surface?: "desktop" | "mobile";
} = {}) {
  const gridClass =
    surface === "desktop"
      ? "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-4 lg:gap-5 xl:grid-cols-5 2xl:grid-cols-6"
      : "grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-3 md:gap-6 lg:grid-cols-4";
  return (
    <div className="space-y-7">
      <div className="flex gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Pulse className="h-11 w-24" key={i} />
        ))}
      </div>
      <div className={gridClass}>
        {Array.from({ length: 8 }, (_, i) => (
          <div className="mx-auto w-full max-w-[260px] space-y-3" key={i}>
            <Pulse className="aspect-[3/4]" />
            <Pulse className="h-4 w-3/4" />
            <Pulse className="h-5 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}
export function ProductDetailSkeleton() {
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <Pulse className="aspect-[3/4]" />
      <div className="space-y-4">
        <Pulse className="h-10 w-3/4" />
        <Pulse className="h-28" />
        <Pulse className="h-52" />
        <Pulse className="h-14" />
      </div>
    </div>
  );
}
