import "server-only";

import { createSupabaseUserClient } from "@/lib/supabase/server";

export interface BegunManualTransfer {
  orderId: string;
  productId: string;
  orderName: string;
  expectedAmount: number;
  status: string;
  bankName: string;
  accountNumber: string;
  requestedAt: string;
  confirmedAt: string | null;
  updatedAt: string;
  isPaymentSettled: boolean;
}

export async function beginManualBankTransfer(accessToken: string, productId: string): Promise<BegunManualTransfer> {
  const { data, error } = await createSupabaseUserClient(accessToken).rpc("begin_manual_transfer", { p_product_id: productId });
  if (error) throw new Error(error.message || "계좌이체 안내를 시작하지 못했습니다.");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("입금 계좌를 확인하지 못했습니다.");
  return {
    orderId: row.order_id,
    productId: row.product_id,
    orderName: row.order_name,
    expectedAmount: Number(row.expected_amount),
    status: row.status,
    bankName: row.bank_name,
    accountNumber: row.account_number,
    requestedAt: row.requested_at,
    confirmedAt: row.confirmed_at,
    updatedAt: row.updated_at,
    isPaymentSettled: Boolean(row.is_payment_settled),
  };
}

export async function confirmManualBankTransfer(accessToken: string, orderId: string, expectedUpdatedAt: string): Promise<void> {
  const { error } = await createSupabaseUserClient(accessToken).rpc("confirm_manual_transfer", {
    p_order_id: orderId,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) throw new Error(error.message || "입금 확정을 완료하지 못했습니다.");
}
