import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request); if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") return commerceJson({ error: "forbidden" }, 403);
  const [{ data: shipping, error: shippingError }, { data: transfers, error: transferError }, { data: orders, error: orderError }, { data: attempts, error: attemptError }, { data: feePayments, error: feePaymentError }, { data: auctionTransfers, error: auctionTransferError }] = await Promise.all([
    auth.admin.from("shipping_requests").select("*").order("requested_at", { ascending: false }).limit(200),
    auth.admin.from("commerce_order_transfers").select("*").in("status", ["awaiting_transfer", "partially_paid"]).order("requested_at", { ascending: false }).limit(501),
    auth.admin.from("commerce_orders").select("*").order("created_at", { ascending: false }).limit(200),
    auth.admin.from("payment_attempts").select("*").order("created_at", { ascending: false }).limit(200),
    auth.admin.from("shipping_fee_payments").select("*").in("status", ["awaiting_transfer", "partially_paid"]).order("requested_at", { ascending: false }).limit(501),
    auth.admin.from("manual_transfer_orders").select("id, product_id, order_name, expected_amount, status, requested_at, confirmed_at").eq("status", "awaiting_manual_transfer").order("requested_at", { ascending: false }).limit(501),
  ]);
  if (shippingError || transferError || orderError || attemptError || feePaymentError || auctionTransferError) {
    return commerceJson({ error: "owner_operations_unavailable" }, 503);
  }
  if (
    (transfers ?? []).length > 500 ||
    (feePayments ?? []).length > 500 ||
    (auctionTransfers ?? []).length > 500
  ) {
    return commerceJson({ error: "owner_operations_queue_limit_exceeded" }, 503);
  }
  const transferIds = (transfers ?? []).map((transfer) => transfer.id);
  const auctionTransferIds = (auctionTransfers ?? []).map((transfer) => transfer.id);
  const feePaymentIds = (feePayments ?? []).map((payment) => payment.id);
  const [commerceBalanceResult, auctionBalanceResult, feeBalanceResult] = await Promise.all([
    transferIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : auth.user.rpc("get_manual_transfer_ledger_balances", { p_transfer_kind: "commerce", p_transfer_ids: transferIds }),
    auctionTransferIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : auth.user.rpc("get_manual_transfer_ledger_balances", { p_transfer_kind: "auction", p_transfer_ids: auctionTransferIds }),
    feePaymentIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : auth.user.rpc("get_manual_transfer_ledger_balances", { p_transfer_kind: "shipping", p_transfer_ids: feePaymentIds }),
  ]);
  if (commerceBalanceResult.error || auctionBalanceResult.error || feeBalanceResult.error) {
    return commerceJson({ error: "owner_operations_unavailable" }, 503);
  }
  const commerceBalances = new Map((commerceBalanceResult.data ?? []).map((balance) => [balance.transfer_id, balance]));
  const auctionBalances = new Map((auctionBalanceResult.data ?? []).map((balance) => [balance.transfer_id, balance]));
  const feeBalances = new Map((feeBalanceResult.data ?? []).map((balance) => [balance.transfer_id, balance]));
  const validBalance = (balance: { received_amount: number; ledger_entry_count: number } | undefined, expectedAmount: number) => Boolean(
    balance &&
    Number.isSafeInteger(balance.received_amount) &&
    balance.received_amount >= 0 &&
    balance.received_amount <= expectedAmount &&
    Number.isSafeInteger(balance.ledger_entry_count) &&
    balance.ledger_entry_count >= 0
  );
  if (
    (commerceBalanceResult.data ?? []).length !== transferIds.length ||
    commerceBalances.size !== transferIds.length ||
    (auctionBalanceResult.data ?? []).length !== auctionTransferIds.length ||
    auctionBalances.size !== auctionTransferIds.length ||
    (feeBalanceResult.data ?? []).length !== feePaymentIds.length ||
    feeBalances.size !== feePaymentIds.length ||
    (transfers ?? []).some((transfer) => !validBalance(commerceBalances.get(transfer.id), transfer.expected_amount)) ||
    (auctionTransfers ?? []).some((transfer) => !validBalance(auctionBalances.get(transfer.id), transfer.expected_amount)) ||
    (feePayments ?? []).some((payment) => !validBalance(feeBalances.get(payment.id), payment.expected_amount))
  ) {
    return commerceJson({ error: "owner_operations_unavailable" }, 503);
  }
  const transfersWithBalance = (transfers ?? []).map((transfer) => {
    const balance = commerceBalances.get(transfer.id)!;
    return { ...transfer, receivedAmount: balance.received_amount, ledgerEntryCount: balance.ledger_entry_count, remainingAmount: transfer.expected_amount - balance.received_amount };
  });
  const auctionTransfersWithBalance = (auctionTransfers ?? []).map((transfer) => {
    const balance = auctionBalances.get(transfer.id)!;
    return { ...transfer, receivedAmount: balance.received_amount, ledgerEntryCount: balance.ledger_entry_count, remainingAmount: transfer.expected_amount - balance.received_amount };
  });
  const feePaymentsWithBalance = (feePayments ?? []).map((payment) => {
    const balance = feeBalances.get(payment.id)!;
    return { ...payment, receivedAmount: balance.received_amount, ledgerEntryCount: balance.ledger_entry_count, remainingAmount: payment.expected_amount - balance.received_amount };
  });
  return commerceJson({ shipping: shipping ?? [], transfers: transfersWithBalance, auctionTransfers: auctionTransfersWithBalance, orders: orders ?? [], attempts: attempts ?? [], feePayments: feePaymentsWithBalance });
}
