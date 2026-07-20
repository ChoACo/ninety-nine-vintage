import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";
import { getCatalogImageUrl } from "@/lib/images";

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  const { data: stores, error: storeError } = auth.roleCode === "owner"
    ? await auth.admin.from("stores").select("id, name, slug, operator_id")
    : await auth.admin.from("stores").select("id, name, slug, operator_id").eq("operator_id", auth.userId);
  if (storeError) return commerceJson({ error: "operator_orders_unavailable" }, 503);
  const storeIds = (stores ?? []).map((store) => store.id);
  if (storeIds.length === 0) return commerceJson({ orders: [], stores: [] });
  const { data: items, error } = await auth.admin
    .from("commerce_order_items")
    .select("*, products(id, title, image_urls, store_id), commerce_orders(id, member_id, status, subtotal, total, created_at)")
    .in("store_id", storeIds)
    .order("created_at", { ascending: false });
  if (error) return commerceJson({ error: "operator_orders_unavailable" }, 503);
  const orderIds = [...new Set((items ?? []).map((item) => item.order_id))];
  const { data: transfers } = orderIds.length === 0
    ? { data: [] }
    : await auth.admin.from("commerce_order_transfers").select("*").in("order_id", orderIds).order("requested_at", { ascending: false });
  const transferIds = (transfers ?? []).map((transfer) => transfer.id);
  const { data: ledger } = transferIds.length === 0
    ? { data: [] }
    : await auth.admin
      .from("manual_transfer_payment_ledger")
      .select("*")
      .in("commerce_order_transfer_id", transferIds)
      .order("created_at", { ascending: false });
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
    return {
      ...transfer,
      receivedAmount,
      remainingAmount: Math.max(0, transfer.expected_amount - receivedAmount),
      ledger: entries,
    };
  });
  return commerceJson({ stores: stores ?? [], items: (items ?? []).map((item) => ({ ...item, products: item.products ? { ...item.products, image_urls: item.products.image_urls.map((image) => getCatalogImageUrl(image, 320)) } : item.products })), transfers: transfersWithBalance });
}
