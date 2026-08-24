function Pulse({ className }: { className: string }) {
  return <div className={`skeleton-shimmer rounded-2xl bg-zinc-800 ${className}`} />;
}

export function CartSkeleton() {
  return (
    <div className="space-y-5">
      <Pulse className="h-20" />
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          {[0, 1].map((index) => (
            <Pulse className="h-64" key={index} />
          ))}
        </div>
        <Pulse className="h-72" />
      </div>
    </div>
  );
}
