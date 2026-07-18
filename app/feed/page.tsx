import type { Metadata } from "next";

import { AuctionApp } from "@/src/components/AuctionApp";

export const metadata: Metadata = {
  title: "경매 피드 | 나인티 나인 빈티지",
};

export default function FeedPage() {
  return <AuctionApp page="feed" />;
}
