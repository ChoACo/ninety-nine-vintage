import { AuctionDetailView } from "@/components/features/auction/detail/AuctionDetailView";
import { LiveAuctionTimeline } from "@/components/features/auction/live/LiveAuctionTimeline";
export default async function Page({params}:{params:Promise<{id:string}>}){const{id}=await params;return <div className="space-y-6"><LiveAuctionTimeline/><AuctionDetailView id={id} surface="mobile"/></div>}
