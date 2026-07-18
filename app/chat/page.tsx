import type { Metadata } from "next";

import { AuctionApp } from "@/src/components/AuctionApp";

export const metadata: Metadata = {
  title: "채팅 | 나인티 나인 빈티지",
  robots: { index: false, follow: false, nocache: true },
};

export default function ChatRoutePage() {
  return <AuctionApp page="chat" />;
}
