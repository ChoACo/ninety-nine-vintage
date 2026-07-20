import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";
import type { Database } from "@/lib/supabase/database.types";

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request); if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") return commerceJson({ error: "forbidden" }, 403);
  const [{ data: shipping }, { data: transfers }, { data: orders }, { data: attempts }, { data: feePayments }, { data: auctionTransfers }] = await Promise.all([
    auth.admin.from("shipping_requests").select("*").order("requested_at", { ascending: false }).limit(200),
    auth.admin.from("commerce_order_transfers").select("*").order("requested_at", { ascending: false }).limit(200),
    auth.admin.from("commerce_orders").select("*").order("created_at", { ascending: false }).limit(200),
    auth.admin.from("payment_attempts").select("*").order("created_at", { ascending: false }).limit(200),
    auth.admin.from("shipping_fee_payments").select("*").order("requested_at", { ascending: false }).limit(200),
    auth.admin.from("manual_transfer_orders").select("id, product_id, order_name, expected_amount, status, requested_at, confirmed_at").order("requested_at", { ascending: false }).limit(200),
  ]);
  const transferIds = (transfers ?? []).map((transfer) => transfer.id);
  const auctionTransferIds = (auctionTransfers ?? []).map((transfer) => transfer.id);
  const feePaymentIds = (feePayments ?? []).map((payment) => payment.id);
  type LedgerEntry = Database["public"]["Tables"]["manual_transfer_payment_ledger"]["Row"];
  let ledger: LedgerEntry[] = [];
  const ledgerFilters = [
    transferIds.length > 0 ? `commerce_order_transfer_id.in.(${transferIds.join(",")})` : null,
    auctionTransferIds.length > 0 ? `manual_transfer_order_id.in.(${auctionTransferIds.join(",")})` : null,
    feePaymentIds.length > 0 ? `shipping_fee_payment_id.in.(${feePaymentIds.join(",")})` : null,
  ].filter((filter): filter is string => Boolean(filter));
  if (ledgerFilters.length > 0) {
    const { data } = await auth.admin.from("manual_transfer_payment_ledger").select("*")
      .or(ledgerFilters.join(","))
      .order("created_at", { ascending: false });
    ledger = data ?? [];
  }
  const ledgerByTransfer = new Map<string, typeof ledger>();
  for (const entry of ledger ?? []) {
    if (!entry.commerce_order_transfer_id) continue;
    ledgerByTransfer.set(entry.commerce_order_transfer_id, [
      ...(ledgerByTransfer.get(entry.commerce_order_transfer_id) ?? []),
      entry,
    ]);
  }
  const transfersWithBalance = (transfers ?? []).map((transfer) => {
    const entries = ledgerByTransfer.get(transfer.id) ?? [];
    const receivedAmount = entries.reduce((sum, entry) => sum + (entry.entry_type === "receipt" ? entry.amount : -entry.amount), 0);
    return { ...transfer, receivedAmount, remainingAmount: Math.max(0, transfer.expected_amount - receivedAmount), ledger: entries };
  });
  const auctionLedgerByTransfer = new Map<string, typeof ledger>();
  for (const entry of ledger ?? []) {
    if (!entry.manual_transfer_order_id) continue;
    auctionLedgerByTransfer.set(entry.manual_transfer_order_id, [
      ...(auctionLedgerByTransfer.get(entry.manual_transfer_order_id) ?? []),
      entry,
    ]);
  }
  const auctionTransfersWithBalance = (auctionTransfers ?? []).map((transfer) => {
    const entries = auctionLedgerByTransfer.get(transfer.id) ?? [];
    const receivedAmount = entries.reduce((sum, entry) => sum + (entry.entry_type === "receipt" ? entry.amount : -entry.amount), 0);
    return { ...transfer, receivedAmount, remainingAmount: Math.max(0, transfer.expected_amount - receivedAmount), ledger: entries };
  });
  const feeLedgerByPayment = new Map<string, typeof ledger>();
  for (const entry of ledger ?? []) {
    if (!entry.shipping_fee_payment_id) continue;
    feeLedgerByPayment.set(entry.shipping_fee_payment_id, [
      ...(feeLedgerByPayment.get(entry.shipping_fee_payment_id) ?? []),
      entry,
    ]);
  }
  const feePaymentsWithBalance = (feePayments ?? []).map((payment) => {
    const entries = feeLedgerByPayment.get(payment.id) ?? [];
    const receivedAmount = entries.reduce((sum, entry) => sum + (entry.entry_type === "receipt" ? entry.amount : -entry.amount), 0);
    return { ...payment, receivedAmount, remainingAmount: Math.max(0, payment.expected_amount - receivedAmount), ledger: entries };
  });
  return commerceJson({ shipping: shipping ?? [], transfers: transfersWithBalance, auctionTransfers: auctionTransfersWithBalance, orders: orders ?? [], attempts: attempts ?? [], feePayments: feePaymentsWithBalance });
}
