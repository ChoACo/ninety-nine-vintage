import type { ReactNode } from "react";
import { CacheConsentBanner } from "@/components/layout/CacheConsentBanner";
import { LiveTickerBar } from "@/components/layout/LiveTickerBar";
import { MobileSiteBottomNav } from "@/components/mobile/MobileSiteBottomNav";
import { MobileSiteHeader } from "@/components/mobile/MobileSiteHeader";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";

export function MobileSiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper text-ink" data-ui-surface="mobile">
      {LIVE_AUCTION_ENABLED && <LiveTickerBar surface="mobile" />}
      <MobileSiteHeader hasLiveTicker={LIVE_AUCTION_ENABLED} />
      <main className="mx-auto min-h-[calc(100svh-7rem)] max-w-5xl px-4 py-5 pb-[calc(6rem+env(safe-area-inset-bottom))]">{children}</main>
      <MobileSiteBottomNav />
      <CacheConsentBanner surface="mobile" />
    </div>
  );
}
