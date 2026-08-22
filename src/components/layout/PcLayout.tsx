import type { ReactNode } from "react";
import { LiveTickerBar } from "@/components/layout/LiveTickerBar";
import { PcHeader } from "@/components/layout/PcHeader";
import { CacheConsentBanner } from "@/components/layout/CacheConsentBanner";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";
import { ActiveBidNavigationProvider } from "@/components/features/auction/ActiveBidNavigationProvider";
import { FloatingChat } from "@/components/features/chat/FloatingChat";
import { PcFooter } from "@/components/layout/PcFooter";

interface PcLayoutProps {
  children: ReactNode;
}

export function PcLayout({ children }: PcLayoutProps) {
  return (
    <ActiveBidNavigationProvider>
      <div className="min-h-screen w-full bg-paper text-ink" data-ui-surface="desktop">
        <div className="mx-auto min-h-screen w-full max-w-[1600px]" data-desktop-canvas="fluid">
          <div className="sticky top-0 z-[70] w-full border-b border-zinc-800/80 bg-paper/85 backdrop-blur-md transition-colors" data-global-sticky-header>
            {LIVE_AUCTION_ENABLED && <LiveTickerBar surface="desktop" />}
            <PcHeader />
          </div>
          <main className="mx-auto min-h-[calc(100vh-7rem)] w-full max-w-[1440px] px-5 py-8 sm:px-8 xl:px-10" data-desktop-content="fluid">{children}</main>
          <PcFooter />
          <CacheConsentBanner surface="desktop" />
          <FloatingChat />
        </div>
      </div>
    </ActiveBidNavigationProvider>
  );
}
