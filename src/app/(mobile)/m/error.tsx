"use client";

import { RouteErrorFallback } from "@/components/ui/RouteErrorFallback";

export default function MobileCommerceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorFallback
      description="장바구니·주문·배송 데이터는 그대로 보존됩니다. 다시 시도하거나 모바일 홈으로 이동해 주세요."
      error={error}
      homeHref="/m/home"
      reset={reset}
      title="모바일 화면을 불러오지 못했습니다"
    />
  );
}
