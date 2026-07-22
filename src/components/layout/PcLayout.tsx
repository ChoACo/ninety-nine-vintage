import type { ReactNode } from "react";
import { LiveTickerBar } from "@/components/layout/LiveTickerBar";
import { PcFooter } from "@/components/layout/PcFooter";
import { PcHeader } from "@/components/layout/PcHeader";
import { CacheConsentBanner } from "@/components/layout/CacheConsentBanner";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";

interface PcLayoutProps {
  children: ReactNode;
}

export function PcLayout({ children }: PcLayoutProps) {
  return (
    <div className="min-h-screen w-full overflow-x-auto bg-paper text-ink" data-ui-surface="desktop">
      <div className="min-h-screen min-w-[1024px]">
        {LIVE_AUCTION_ENABLED && <LiveTickerBar surface="desktop" />}
        <PcHeader hasLiveTicker={LIVE_AUCTION_ENABLED} />
        <main className="mx-auto min-h-[calc(100vh-7rem)] max-w-[1680px] px-10 py-8 xl:px-12">{children}</main>
        <PcFooter />
        <CacheConsentBanner surface="desktop" />
      </div>
    </div>
  );
}
