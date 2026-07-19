import type { Metadata } from "next";

import { AuctionApp } from "@/src/components/AuctionApp";

export const metadata: Metadata = {
  title: "나인티 나인 빈티지 | 처음 오셨나요?",
  description: "나인티 나인 빈티지의 경매와 상시 구매 이용 방법을 한눈에 확인하세요.",
};

export default function HomeGuidePage() {
  return <AuctionApp page="home" />;
}
