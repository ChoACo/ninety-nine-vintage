import type { ReactNode } from "react";
import { CacheConsentBanner } from "@/components/layout/CacheConsentBanner";
import { LiveTickerBar } from "@/components/layout/LiveTickerBar";
import { MobileSiteBottomNav } from "@/components/mobile/MobileSiteBottomNav";
import { MobileSiteHeader } from "@/components/mobile/MobileSiteHeader";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";
import { ActiveBidNavigationProvider } from "@/components/features/auction/ActiveBidNavigationProvider";
import { MobilePwaProvider } from "@/components/features/pwa/MobilePwaProvider";

export function MobileSiteLayout({ children }: { children: ReactNode }) {
  return (
    <MobilePwaProvider>
      <ActiveBidNavigationProvider>
        <div className="min-h-screen overflow-x-hidden bg-paper text-ink" data-ui-surface="mobile">
          {LIVE_AUCTION_ENABLED && <LiveTickerBar surface="mobile" />}
          <MobileSiteHeader hasLiveTicker={LIVE_AUCTION_ENABLED} />
          <main className="mx-auto min-h-[calc(100svh-7rem)] w-full max-w-lg px-4 py-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))]">{children}</main>
          <MobileSiteBottomNav />
          <CacheConsentBanner surface="mobile" />
        </div>
      </ActiveBidNavigationProvider>
    </MobilePwaProvider>
  );
}
