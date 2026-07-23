import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MobileSiteLayout } from "@/components/mobile/MobileSiteLayout";
import { MOBILE_SITE_ENABLED } from "@/lib/featureFlags";

export const metadata: Metadata = {
  title: { default: "NINETY-NINE 모바일", template: "%s | NINETY-NINE" },
  robots: { follow: true, index: true },
};

export default function MobileLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!MOBILE_SITE_ENABLED) notFound();
  return <MobileSiteLayout>{children}</MobileSiteLayout>;
}
