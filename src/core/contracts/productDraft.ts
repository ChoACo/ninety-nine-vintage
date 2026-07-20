import type {
  AuctionStatus,
  ISODateString,
  ProductSaleType,
} from "@/src/types/auction";

/**
 * Product-registration contract shared by future operator screens, the batch
 * importer, and the Supabase repository.  It intentionally has no UI
 * component dependency so a new application shell can be built independently.
 */
export interface NewAuctionDraft {
  title: string;
  description: string;
  saleType: ProductSaleType;
  fixedPrice: number | null;
  startingPrice: number;
  bidIncrement: number;
  imageFiles: File[];
  status: Exclude<AuctionStatus, "closed">;
  publish_at: ISODateString;
}
