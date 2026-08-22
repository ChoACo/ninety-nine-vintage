import { ChartSkeleton, OwnerMetricSkeleton } from "@/components/admin/owner/OwnerSkeletons";

export default function OwnerLoading() {
  return <div className="space-y-6"><div className="h-20 animate-pulse rounded-2xl bg-zinc-900" /><OwnerMetricSkeleton /><div className="grid gap-4 xl:grid-cols-3"><ChartSkeleton /><ChartSkeleton /><ChartSkeleton /></div></div>;
}
