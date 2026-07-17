import type {
  AdminCustomerChatPayload,
  AdminCustomerChatThread,
  AdminSaleRecord,
  BuyerInfo,
} from "@/src/types/auction";

export type { AdminCustomerChatThread };

export type SettlementStatusTone = "warning" | "mint" | "blue" | "slate";

export interface AdminSettlementGroup {
  id: string;
  buyer: BuyerInfo;
  sales: readonly AdminSaleRecord[];
  totalWinningBid: number;
  statusLabel: string;
  statusTone: SettlementStatusTone;
}

export interface RecentClosingDay {
  dateKey: string;
  label: string;
  weekdayLabel: string;
  isToday: boolean;
  sales: readonly AdminSaleRecord[];
  settlements: readonly AdminSettlementGroup[];
}

export type SendAdminCustomerMessage = (
  payload: AdminCustomerChatPayload,
) => void | Promise<void>;
