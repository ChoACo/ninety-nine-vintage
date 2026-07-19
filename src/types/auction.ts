export type AuctionStatus = "pending" | "active" | "closed";
export type ProductSaleType = "auction" | "fixed";

export interface Item {
  id: string;
  auctionId: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  imageUrl: string;
  thumbnailUrl?: string;
  condition?: "NEW" | "EXCELLENT" | "GOOD" | "FAIR";
  size?: string;
  startingPrice: number;
  currentBid: number;
  fixedPrice?: number | null;
  bidCount: number;
  status: AuctionStatus;
  saleType: ProductSaleType;
  publishAt?: string;
  closesAt?: string;
  bidIncrement?: number;
  bidHistory?: Bid[];
}

export interface Bid {
  id: string;
  itemId: string;
  bidderId: string;
  bidderName: string;
  amount: number;
  createdAt: string;
}

export interface AuctionTimeline {
  auctionDate: string;
  status: AuctionStatus;
  opensAt: string;
  biddingRestrictedAt: string;
  closesAt: string;
  reAuctionStartsAt: string;
  reAuctionEndsAt: string;
}
