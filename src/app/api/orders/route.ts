import { authenticateMemberRlsRequest, commerceJson } from "@/lib/commerce/server";
import { getCatalogImageUrl } from "@/lib/images";

export async function GET(request: Request) {
  // Order history is an owner-scoped read and should keep working with the
  // caller's RLS session; it does not need a privileged Supabase credential.
  const auth = await authenticateMemberRlsRequest(request);
  if (!auth.ok) return auth.response;
  const { data: orders, error } = await auth.user
    .from("commerce_orders")
    .select("id, status, subtotal, shipping_fee, total, created_at, updated_at, commerce_order_items(id, product_id, unit_price, payment_status, paid_at, storage_expires_at, products(id, title, image_urls, status, storage_class))")
    .eq("member_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return commerceJson({ error: "orders_unavailable" }, 503);
  const orderIds = (orders ?? []).map((order) => order.id);
  const { data: transfers, error: transferError } = orderIds.length === 0
    ? { data: [], error: null }
    : await auth.user.from("commerce_order_transfers").select("*").in("order_id", orderIds);
  if (transferError) return commerceJson({ error: "orders_unavailable" }, 503);
  const { data: legacyProviderPayments, error: legacyProviderPaymentError } =
    orderIds.length === 0
      ? { data: [], error: null }
      : await auth.user
          .from("payment_orders")
          .select(
            "commerce_order_id, payment_id, payment_status, portone_status, paid_at",
          )
          .in("commerce_order_id", orderIds);
  if (legacyProviderPaymentError) {
    return commerceJson({ error: "orders_unavailable" }, 503);
  }
  const { data: confirmationRequests, error: confirmationRequestError } =
    orderIds.length === 0
      ? { data: [], error: null }
      : await auth.user
          .from("commerce_payment_confirmation_requests")
          .select("id, order_id, status, first_requested_at, last_requested_at, reminder_count")
          .in("order_id", orderIds);
  if (confirmationRequestError) {
    return commerceJson({ error: "orders_unavailable" }, 503);
  }
  const transferByOrder = new Map((transfers ?? []).map((transfer) => [transfer.order_id, transfer]));
  const legacyProviderPaymentByOrder = new Map(
    (legacyProviderPayments ?? [])
      .filter((payment) => Boolean(payment.commerce_order_id))
      .map((payment) => [payment.commerce_order_id, payment]),
  );
  const confirmationRequestByOrder = new Map(
    (confirmationRequests ?? []).map((confirmationRequest) => [
      confirmationRequest.order_id,
      confirmationRequest,
    ]),
  );
  return commerceJson({ orders: (orders ?? []).map((order) => ({
    ...order,
    transfer: transferByOrder.get(order.id) ?? null,
    paymentConfirmation: (() => {
      const transfer = transferByOrder.get(order.id);
      const confirmationRequest = confirmationRequestByOrder.get(order.id) ?? null;
      const eligibleAt = transfer?.requested_at
        ? new Date(Date.parse(transfer.requested_at) + 12 * 60 * 60 * 1000).toISOString()
        : null;
      return {
        eligibleAt,
        canRequest: Boolean(
          eligibleAt && Date.now() >= Date.parse(eligibleAt) &&
          ["awaiting_transfer", "partially_paid"].includes(transfer?.status ?? ""),
        ),
        request: confirmationRequest,
      };
    })(),
    legacyPaymentHistory: (() => {
      const payment = legacyProviderPaymentByOrder.get(order.id);
      if (!payment) return null;
      return {
        paymentId: payment.payment_id,
        paymentStatus: payment.payment_status,
        providerStatus: payment.portone_status,
        paidAt: payment.paid_at,
      };
    })(),
    commerce_order_items: order.commerce_order_items?.map((item) => item.products ? {
      ...item,
      products: { ...item.products, image_urls: item.products.image_urls.map((image) => getCatalogImageUrl(image, 320)) },
    } : item),
  })) });
}
