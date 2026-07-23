"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { PremiumDialog } from "@/components/ui/PremiumDialog";

export function MobileBidSheet({ children, productId }: { children: ReactNode; productId: string }) {
  const router = useRouter();
  const close = () => router.replace(`/m/auction/${productId}`);

  return (
    <PremiumDialog labelledBy="mobile-quick-bid-title" onClose={close} open panelClassName="max-w-lg" placement="sheet-bottom">
      <header className="flex items-center justify-between border-b border-line px-5 py-4">
        <div><p className="eyebrow text-muted">빠른 거래</p><h1 className="mt-1 text-lg font-black" id="mobile-quick-bid-title">빠른 입찰</h1></div>
        <button aria-label="빠른 입찰 닫기" className="grid size-11 place-items-center" onClick={close} type="button"><X size={20} /></button>
      </header>
      <div className="max-h-[75svh] overflow-y-auto p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">{children}</div>
    </PremiumDialog>
  );
}
