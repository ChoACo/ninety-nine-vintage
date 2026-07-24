import type { Metadata } from "next";
import { ActiveBidProducts } from "@/components/features/auction/ActiveBidProducts";

export const metadata: Metadata = {
  title: "입찰 중인 상품 | NINETY-NINE VINTAGE",
  robots: { follow: false, index: false },
};

export default function BiddingPage() {
  return <ActiveBidProducts />;
}
