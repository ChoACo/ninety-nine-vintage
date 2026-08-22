export type SaleType = "auction" | "shop";
export type SettlementStatus = "pending" | "paid" | "refund";

export interface SalesEntry {
  id: string;
  entryKind: "item_payment" | "item_refund" | "payment_reversal";
  amount: number;
  occurredAt: string;
  productTitle: string | null;
  saleType: SaleType;
  productCategory: string;
  buyerMasked: string | null;
  orderNumber: string;
  commissionAmount: number;
  settlementStatus: "pending" | "paid" | null;
  settlementDate: string | null;
}

export interface SalesStoreReport {
  storeId: string;
  storeName: string;
  grossSales: number;
  refunds: number;
  netSales: number;
  entries: SalesEntry[];
}

export interface SalesMetrics {
  gross: number;
  previousGross: number;
  auctionGross: number;
  auctionCount: number;
  shopGross: number;
  shopCount: number;
  commission: number;
  payout: number;
  nextSettlementDate: string | null;
}
