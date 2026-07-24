import type { ReactNode } from "react";
import { LiveTickerBar } from "@/components/layout/LiveTickerBar";
import { PcFooter } from "@/components/layout/PcFooter";
import { PcHeader } from "@/components/layout/PcHeader";
import { CacheConsentBanner } from "@/components/layout/CacheConsentBanner";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";
import { ActiveBidNavigationProvider } from "@/components/features/auction/ActiveBidNavigationProvider";

interface PcLayoutProps {
  children: ReactNode;
}

export function PcLayout({ children }: PcLayoutProps) {
  return (
    <ActiveBidNavigationProvider>
      <div className="min-h-screen w-full overflow-x-auto bg-paper text-ink" data-ui-surface="desktop">
        <div className="mx-auto min-h-screen w-[1280px] min-w-[1280px]" data-desktop-canvas="1280">
          {LIVE_AUCTION_ENABLED && <LiveTickerBar surface="desktop" />}
          <PcHeader hasLiveTicker={LIVE_AUCTION_ENABLED} />
          <main className="mx-auto min-h-[calc(100vh-7rem)] w-[1200px] py-8" data-desktop-content="1200">{children}</main>
          <PcFooter />
          <CacheConsentBanner surface="desktop" />
        </div>
      </div>
    </ActiveBidNavigationProvider>
  );
}
