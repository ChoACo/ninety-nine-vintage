import type { Bid, Item } from "@/types/auction";

export type ConditionGrade = "S" | "A+" | "A" | "B";

export interface ItemMeasurements {
  shoulder: number;
  chest: number;
  sleeve: number;
  length: number;
}

export interface BidHistoryEntry extends Bid {
  bidderMaskedId: string;
  outcome?: "active" | "cancelled" | "unpaid_cancelled";
  timeLabel: string;
}

export interface ItemDetail extends Item {
  bidLockedAt?: string | null;
  finalBidAmount?: number | null;
  antiSnipingBaseClosesAt?: string | null;
  antiSnipingExtendedAt?: string | null;
  antiSnipingExtensionCount?: number;
  images: string[];
  conditionGrade: ConditionGrade;
  measurements: ItemMeasurements;
  participantCount: number;
  inspectionNotes: string[];
  bidHistory: BidHistoryEntry[];
}
