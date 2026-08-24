import type { CSSProperties, ReactNode } from "react";
import { CacheConsentBanner } from "@/components/layout/CacheConsentBanner";
import { LiveTickerBar } from "@/components/layout/LiveTickerBar";
import { MobileSiteBottomNav } from "@/components/mobile/MobileSiteBottomNav";
import { MobileSiteHeader } from "@/components/mobile/MobileSiteHeader";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";
import { ActiveBidNavigationProvider } from "@/components/features/auction/ActiveBidNavigationProvider";
import { MobilePwaProvider } from "@/components/features/pwa/MobilePwaProvider";
import { PwaInstallPrompt } from "@/components/features/pwa/PwaInstallPrompt";
import { FloatingChat } from "@/components/features/chat/FloatingChat";
import { MobileAutoHideHeader } from "@/components/mobile/MobileAutoHideHeader";
import { SideNavRail } from "@/components/layout/SideNavRail";

export function MobileSiteLayout({ children }: { children: ReactNode }) {
  return (
    <MobilePwaProvider>
      <ActiveBidNavigationProvider>
        <div
          className="min-h-screen overflow-x-hidden bg-paper text-ink"
          data-ui-surface="mobile"
          style={{
            "--mobile-sticky-header-offset": LIVE_AUCTION_ENABLED
              ? "6rem"
              : "3.5rem",
          } as CSSProperties}
        >
          <MobileAutoHideHeader>
            {LIVE_AUCTION_ENABLED && <LiveTickerBar surface="mobile" />}
            <MobileSiteHeader />
          </MobileAutoHideHeader>
          <SideNavRail />
          <main className="mx-auto min-h-[calc(100svh-7rem)] w-full min-w-0 max-w-lg overflow-x-clip px-4 py-4 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:max-w-3xl lg:max-w-6xl lg:pl-24 lg:pr-6">{children}</main>
          <MobileSiteBottomNav />
          <CacheConsentBanner surface="mobile" />
          <FloatingChat basePath="/m" />
          <PwaInstallPrompt />
        </div>
      </ActiveBidNavigationProvider>
    </MobilePwaProvider>
  );
}
