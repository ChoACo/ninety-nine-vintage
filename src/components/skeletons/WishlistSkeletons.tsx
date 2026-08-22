export function WishlistGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div className="space-y-3" key={i}>
          <div className="aspect-[3/4] animate-pulse rounded-2xl bg-zinc-800" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-800" />
          <div className="h-11 animate-pulse rounded-xl bg-zinc-800" />
        </div>
      ))}
    </div>
  );
}
