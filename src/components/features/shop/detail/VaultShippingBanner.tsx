"use client";

import { PackageCheck } from "lucide-react";
import { usePlatformConfig } from "@/hooks/usePlatformConfig";

export function VaultShippingBanner() {
  const config = usePlatformConfig();
  return (
    <aside className="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-3 sm:p-5">
      <p className="inline-flex items-center gap-2 text-xs font-black text-emerald-700">
        <PackageCheck size={17} /> 보관함 · 묶음배송
      </p>
      <p className="mt-3 break-keep text-xs leading-6 text-muted-foreground">
        이 상품은 결제 후 나인티나인 보관함에 최대 {config.storageDurationDays}일간
        무료 보관되며, 같은 센터의 다른 상품과 묶음 배송받을 수 있습니다. 기본
        배송비는 {new Intl.NumberFormat("ko-KR").format(config.globalDeliveryFee)}원이며
        센터별 정책에 따라 달라질 수 있습니다.
      </p>
    </aside>
  );
}
