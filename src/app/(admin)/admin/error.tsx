"use client";

import { RouteErrorFallback } from "@/components/ui/RouteErrorFallback";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorFallback
      description="업무 데이터는 변경되지 않았습니다. 잠시 후 다시 시도하거나 업무 센터 첫 화면으로 이동해 주세요."
      error={error}
      homeHref="/admin/operator"
      reset={reset}
      title="업무 화면을 불러오지 못했습니다"
    />
  );
}
