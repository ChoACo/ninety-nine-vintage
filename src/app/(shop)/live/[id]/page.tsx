import type { Metadata } from "next";
import Link from "next/link";
import { AuctionDetailView } from "@/components/features/auction/detail/AuctionDetailView";
import { LiveAuctionTimeline } from "@/components/features/auction/live/LiveAuctionTimeline";

export const metadata: Metadata = { title: "라이브 옥션 상세 | NINETY-NINE VINTAGE" };

export default async function LiveAuctionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <div className="space-y-8"><div><Link className="text-xs font-bold text-muted underline" href="/live">← 라이브 옥션으로</Link><p className="mt-5 text-[10px] font-black tracking-[.16em] text-rose-500">LIVE BIDDING</p><h1 className="mt-2 text-3xl font-black tracking-[-.05em]">라이브 옥션 상세</h1></div><LiveAuctionTimeline /><AuctionDetailView id={id} /></div>;
}
