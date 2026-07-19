import { AuctionFeedGrid } from "@/components/features/auction/AuctionFeedGrid";
import { AuctionFilterSidebar } from "@/components/features/auction/AuctionFilterSidebar";

export default function ShopPage() { return <div className="flex items-start gap-10"><AuctionFilterSidebar /><AuctionFeedGrid className="flex-1" saleType="fixed" title="상시 바로구매" /></div>; }

