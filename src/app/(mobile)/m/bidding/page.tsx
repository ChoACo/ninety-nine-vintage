import type { Metadata } from "next";
import { ActiveBidProducts } from "@/components/features/auction/ActiveBidProducts";

export const metadata: Metadata = {
  title: "입찰 중인 상품",
  robots: { follow: false, index: false },
};

export default function MobileBiddingPage() {
  return <ActiveBidProducts basePath="/m" surface="mobile" />;
}
