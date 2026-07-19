import { AuctionFeedGrid } from "@/components/features/auction/AuctionFeedGrid";
import { AuctionFilterSidebar } from "@/components/features/auction/AuctionFilterSidebar";

export default function FeedPage() { return <div className="flex items-start gap-10"><AuctionFilterSidebar /><AuctionFeedGrid className="flex-1" saleType="auction" title="LIVE DROP" /></div>; }

