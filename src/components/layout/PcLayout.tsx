import type { ReactNode } from "react";
import { LiveTickerBar } from "@/components/layout/LiveTickerBar";
import { PcFooter } from "@/components/layout/PcFooter";
import { PcHeader } from "@/components/layout/PcHeader";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { CacheConsentBanner } from "@/components/layout/CacheConsentBanner";

interface PcLayoutProps {
  children: ReactNode;
}

export function PcLayout({ children }: PcLayoutProps) {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <LiveTickerBar />
      <PcHeader />
      <main className="mx-auto min-h-[calc(100vh-7rem)] max-w-[1680px] px-4 py-7 pb-28   px-10 pb-7 xl:px-12">{children}</main>
      <PcFooter />
      <MobileBottomNav />
      <CacheConsentBanner />
    </div>
  );
}
