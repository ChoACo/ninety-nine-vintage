import { AuctionBidRoute } from "@/components/features/auction/detail/AuctionBidRoute";
export default async function Page({params}:{params:Promise<{id:string}>}){const{id}=await params;return <AuctionBidRoute basePath="/m" productId={id}/>}
