import type { Metadata } from "next";

import { AuctionApp } from "@/src/components/AuctionApp";

export const metadata: Metadata = {
  title: "상시 구매 | 나인티 나인 빈티지",
  description: "표시된 정가로 바로 구매할 수 있는 나인티 나인 빈티지 상시 구매 상품을 확인하세요.",
};

export default function ShopRoutePage() {
  return <AuctionApp page="shop" />;
}
