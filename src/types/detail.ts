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
  timeLabel: string;
}

export interface ItemDetail extends Item {
  images: string[];
  conditionGrade: ConditionGrade;
  measurements: ItemMeasurements;
  inspectionNotes: string[];
  bidHistory: BidHistoryEntry[];
}
