export function WishlistGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div className="space-y-3" key={i}>
          <div className="skeleton-shimmer aspect-[3/4] rounded-2xl bg-zinc-800" />
          <div className="skeleton-shimmer h-4 w-3/4 rounded bg-zinc-800" />
          <div className="skeleton-shimmer h-11 rounded-xl bg-zinc-800" />
        </div>
      ))}
    </div>
  );
}
