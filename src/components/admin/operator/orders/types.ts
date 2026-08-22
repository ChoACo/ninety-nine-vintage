export type OrderStatusFilter = "all" | "vault_pending" | "ready_to_ship" | "shipping" | "completed" | "cancelled";
export type OrderSaleFilter = "all" | "auction" | "shop";

export interface OperatorOrderItem {
  order_id: string;
  product_id: string;
  unit_price: number;
  payment_status: string;
  conditionGrade: string | null;
  saleType: "auction" | "shop";
  products?: { title: string; image_urls: string[] } | null;
  commerce_orders?: { member_id: string; total: number; status: string; created_at: string } | null;
}

export interface OperatorOrderLedgerEntry {
  id: string;
  entry_type: "receipt" | "reversal";
  amount: number;
  depositor_name: string | null;
  memo: string;
  created_at: string;
  reversal_of: string | null;
  recorded_by: string;
}

export interface OperatorOrderTransfer {
  id: string;
  order_id: string;
  member_id: string;
  buyerMasked: string;
  status: string;
  expected_amount: number;
  receivedAmount: number;
  ledgerEntryCount: number;
  ledgerHistoryComplete: boolean;
  remainingAmount: number;
  bank_name_snapshot: string;
  requested_at: string;
  activityAt: string;
  orderMeta: {
    id: string;
    member_id: string;
    status: string;
    subtotal: number;
    shipping_fee: number;
    total: number;
    created_at: string;
  } | null;
  ledger: OperatorOrderLedgerEntry[];
  items: OperatorOrderItem[];
}

export function orderWorkflowStatus(order: OperatorOrderTransfer): OrderStatusFilter {
  if (order.status === "cancelled" || order.orderMeta?.status === "cancelled" || order.orderMeta?.status === "refunded") return "cancelled";
  if (order.orderMeta?.status === "shipped") return "shipping";
  if (order.status !== "confirmed") return "vault_pending";
  return (order.orderMeta?.shipping_fee ?? 0) > 0 ? "ready_to_ship" : "vault_pending";
}

export function orderShippingMode(order: OperatorOrderTransfer): "vault" | "immediate" {
  return (order.orderMeta?.shipping_fee ?? 0) > 0 ? "immediate" : "vault";
}
