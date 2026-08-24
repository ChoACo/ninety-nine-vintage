function Pulse({ className }: { className: string }) {
  return <div className={`skeleton-shimmer rounded-2xl bg-zinc-800 ${className}`} />;
}

export function MyProfileSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex gap-4">
        <Pulse className="size-16 rounded-full" />
        <div className="flex-1 space-y-2">
          <Pulse className="h-7 w-44" />
          <Pulse className="h-4 w-56" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Pulse className="h-28" key={index} />
        ))}
      </div>
    </div>
  );
}

export function VaultCardSkeleton() {
  return (
    <div className="flex gap-4">
      <Pulse className="h-28 w-20" />
      <div className="flex-1 space-y-3">
        <Pulse className="h-5 w-2/3" />
        <Pulse className="h-4 w-1/3" />
        <Pulse className="h-3 w-full" />
      </div>
    </div>
  );
}

export function OrderTimelineSkeleton() {
  return (
    <div className="space-y-5">
      <Pulse className="h-6 w-48" />
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Pulse className="h-10" key={index} />
        ))}
      </div>
    </div>
  );
}
