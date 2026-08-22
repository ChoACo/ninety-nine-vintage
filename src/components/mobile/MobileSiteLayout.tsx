import type { ReactNode } from "react";
import { CacheConsentBanner } from "@/components/layout/CacheConsentBanner";
import { LiveTickerBar } from "@/components/layout/LiveTickerBar";
import { MobileSiteBottomNav } from "@/components/mobile/MobileSiteBottomNav";
import { MobileSiteHeader } from "@/components/mobile/MobileSiteHeader";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";
import { ActiveBidNavigationProvider } from "@/components/features/auction/ActiveBidNavigationProvider";
import { MobilePwaProvider } from "@/components/features/pwa/MobilePwaProvider";
import { PwaInstallPrompt } from "@/components/features/pwa/PwaInstallPrompt";
import { FloatingChat } from "@/components/features/chat/FloatingChat";

export function MobileSiteLayout({ children }: { children: ReactNode }) {
  return (
    <MobilePwaProvider>
      <ActiveBidNavigationProvider>
        <div className="min-h-screen overflow-x-hidden bg-paper text-ink" data-ui-surface="mobile">
          <div className="sticky top-0 z-[70] w-full border-b border-zinc-800/80 bg-paper/85 backdrop-blur-md transition-colors" data-global-sticky-header>
            {LIVE_AUCTION_ENABLED && <LiveTickerBar surface="mobile" />}
            <MobileSiteHeader />
          </div>
          <main className="mx-auto min-h-[calc(100svh-7rem)] w-full max-w-lg px-4 py-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))]">{children}</main>
          <MobileSiteBottomNav />
          <CacheConsentBanner surface="mobile" />
          <FloatingChat basePath="/m" />
          <PwaInstallPrompt />
        </div>
      </ActiveBidNavigationProvider>
    </MobilePwaProvider>
  );
}
