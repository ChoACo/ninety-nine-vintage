import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";
import { getCatalogImageUrl } from "@/lib/images";

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner" && auth.roleCode !== "operator") {
    return commerceJson({ error: "forbidden" }, 403);
  }
  const [activeTransferResult, recentTransferResult] = await Promise.all([
    auth.admin
      .from("commerce_order_transfers")
      .select("id, order_id, member_id, expected_amount, status, bank_name_snapshot, account_number_snapshot, requested_at, confirmed_at, confirmed_by")
      .in("status", ["awaiting_transfer", "partially_paid"])
      .order("requested_at", { ascending: false })
      .limit(401),
    auth.admin
      .from("commerce_order_transfers")
      .select("id, order_id, member_id, expected_amount, status, bank_name_snapshot, account_number_snapshot, requested_at, confirmed_at, confirmed_by")
      .in("status", ["confirmed", "cancelled"])
      .order("requested_at", { ascending: false })
      .limit(101),
  ]);
  if (activeTransferResult.error || recentTransferResult.error) {
    return commerceJson({ error: "operator_orders_unavailable" }, 503);
  }
  if ((activeTransferResult.data ?? []).length > 400) {
    return commerceJson({ error: "operator_orders_queue_limit_exceeded" }, 503);
  }
  const recentHistoryTruncated = (recentTransferResult.data ?? []).length > 100;
  const transferById = new Map(
    (activeTransferResult.data ?? []).map((transfer) => [transfer.id, transfer]),
  );
  for (const transfer of (recentTransferResult.data ?? []).slice(0, 100)) {
    // Prefer the non-actionable snapshot if a status transition crosses the
    // two concurrent reads. A refresh can recover; a stale receipt form cannot.
    transferById.set(transfer.id, transfer);
  }
  const transfers = [...transferById.values()];
  const transferIds = transfers.map((transfer) => transfer.id);
  const orderIds = [...new Set(transfers.map((transfer) => transfer.order_id))];
  const [summaryResult, balanceResult] = await Promise.all([
    orderIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : auth.user.rpc("get_shared_commerce_payment_order_summaries", {
        p_order_ids: orderIds,
      }),
    transferIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : auth.user.rpc("get_manual_transfer_ledger_balances", {
        p_transfer_kind: "commerce",
        p_transfer_ids: transferIds,
      }),
  ]);
  if (summaryResult.error || balanceResult.error) {
    return commerceJson({ error: "operator_orders_unavailable" }, 503);
  }
  const { data: ledger, error: ledgerError } = transferIds.length === 0
    ? { data: [], error: null }
    : await auth.admin
      .from("manual_transfer_payment_ledger")
      .select("id, commerce_order_transfer_id, entry_type, amount, depositor_name, memo, reversal_of, recorded_by, created_at")
      .in("commerce_order_transfer_id", transferIds)
      .order("created_at", { ascending: false })
      .limit(1000);
  if (ledgerError) return commerceJson({ error: "operator_orders_unavailable" }, 503);
  const balances = new Map(
    (balanceResult.data ?? []).map((balance) => [balance.transfer_id, balance]),
  );
  const summaries = new Map(
    (summaryResult.data ?? []).map((summary) => [summary.order_id, summary]),
  );
  if (
    (balanceResult.data ?? []).length !== transferIds.length ||
    balances.size !== transferIds.length ||
    (summaryResult.data ?? []).length !== orderIds.length ||
    summaries.size !== orderIds.length ||
    (summaryResult.data ?? []).some((summary) =>
      !Number.isSafeInteger(summary.item_count) ||
      summary.item_count < 1 ||
      summary.item_count > 50 ||
      !Array.isArray(summary.items) ||
      summary.items.length !== summary.item_count
    )
  ) {
    return commerceJson({ error: "operator_orders_unavailable" }, 503);
  }
  const ledgerByTransfer = new Map<string, typeof ledger>();
  for (const entry of ledger ?? []) {
    if (!entry.commerce_order_transfer_id) continue;
    ledgerByTransfer.set(entry.commerce_order_transfer_id, [
      ...(ledgerByTransfer.get(entry.commerce_order_transfer_id) ?? []),
      entry,
    ]);
  }
  const transfersWithBalance = [];
  for (const transfer of transfers) {
    const entries = ledgerByTransfer.get(transfer.id) ?? [];
    const balance = balances.get(transfer.id);
    if (
      !balance ||
      !Number.isSafeInteger(balance.received_amount) ||
      balance.received_amount < 0 ||
      balance.received_amount > transfer.expected_amount ||
      !Number.isSafeInteger(balance.ledger_entry_count) ||
      balance.ledger_entry_count < 0
    ) {
      return commerceJson({ error: "operator_orders_unavailable" }, 503);
    }
    transfersWithBalance.push({
      ...transfer,
      receivedAmount: balance.received_amount,
      ledgerEntryCount: balance.ledger_entry_count,
      ledgerHistoryComplete: entries.length === balance.ledger_entry_count,
      remainingAmount: transfer.expected_amount - balance.received_amount,
      ledger: entries,
    });
  }
  const items = (summaryResult.data ?? []).flatMap((summary) =>
    (summary.items as Array<{
      order_id: string;
      product_id: string;
      unit_price: number;
      payment_status: string;
      products: { title: string; image_urls: string[] } | null;
      commerce_orders: {
        member_id: string;
        status: string;
        total: number;
        created_at: string;
      } | null;
    }>).map((item) => ({
      ...item,
      products: item.products
        ? {
          ...item.products,
          image_urls: item.products.image_urls.map((image) =>
            getCatalogImageUrl(image, 320)
          ),
        }
        : item.products,
    }))
  );
  return commerceJson({ items, transfers: transfersWithBalance, recentHistoryTruncated });
}
