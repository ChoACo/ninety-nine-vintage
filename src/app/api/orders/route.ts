import { authenticateMemberRlsRequest, commerceJson } from "@/lib/commerce/server";
import { getCatalogImageUrl } from "@/lib/images";
import { isPortOnePayMethod, isValidPaymentId } from "@/lib/portone/server";

const RETRYABLE_PORTONE_STATUSES = new Set([
  "READY",
  "FAILED",
  "CANCELLED",
]);

export async function GET(request: Request) {
  // Order history is an owner-scoped read and should keep working with the
  // caller's RLS session; it does not need a privileged Supabase credential.
  const auth = await authenticateMemberRlsRequest(request);
  if (!auth.ok) return auth.response;
  const { data: orders, error } = await auth.user
    .from("commerce_orders")
    .select("id, status, subtotal, shipping_fee, total, created_at, updated_at, commerce_order_items(id, product_id, unit_price, payment_status, paid_at, storage_expires_at, products(id, title, image_urls, status))")
    .eq("member_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return commerceJson({ error: "orders_unavailable" }, 503);
  const orderIds = (orders ?? []).map((order) => order.id);
  const { data: transfers, error: transferError } = orderIds.length === 0
    ? { data: [], error: null }
    : await auth.user.from("commerce_order_transfers").select("*").in("order_id", orderIds);
  if (transferError) return commerceJson({ error: "orders_unavailable" }, 503);
  const { data: portonePayments, error: portonePaymentError } =
    orderIds.length === 0
      ? { data: [], error: null }
      : await auth.user
          .from("payment_orders")
          .select(
            "commerce_order_id, buyer_id, payment_id, payment_status, portone_status, requested_method, payment_method, expected_amount, currency, vbank_num, vbank_bank, vbank_due, paid_at",
          )
          .in("commerce_order_id", orderIds);
  if (portonePaymentError) {
    return commerceJson({ error: "orders_unavailable" }, 503);
  }
  const transferByOrder = new Map((transfers ?? []).map((transfer) => [transfer.order_id, transfer]));
  const portonePaymentByOrder = new Map(
    (portonePayments ?? [])
      .filter((payment) => Boolean(payment.commerce_order_id))
      .map((payment) => [payment.commerce_order_id, payment]),
  );
  return commerceJson({ orders: (orders ?? []).map((order) => ({
    ...order,
    transfer: transferByOrder.get(order.id) ?? null,
    portonePayment: (() => {
      const payment = portonePaymentByOrder.get(order.id);
      if (!payment) return null;
      const orderItems = order.commerce_order_items ?? [];
      const productIds = orderItems.map((item) => item.product_id);
      const itemsAreRecoverable =
        orderItems.length > 0 &&
        orderItems.length <= 50 &&
        new Set(productIds).size === orderItems.length &&
        orderItems.every(
          (item) =>
            item.payment_status === "awaiting_payment" &&
            Number.isSafeInteger(item.unit_price) &&
            item.unit_price > 0 &&
            Boolean(item.products),
        );
      return {
        paymentStatus: payment.payment_status,
        portoneStatus: payment.portone_status,
        requestedMethod: payment.requested_method,
        paymentMethod: payment.payment_method,
        canResume:
          order.status === "awaiting_payment" &&
          payment.buyer_id === auth.userId &&
          payment.paid_at === null &&
          payment.expected_amount === order.total &&
          payment.currency === "KRW" &&
          isValidPaymentId(payment.payment_id) &&
          isPortOnePayMethod(payment.requested_method) &&
          itemsAreRecoverable &&
          (payment.portone_status === null ||
            RETRYABLE_PORTONE_STATUSES.has(payment.portone_status)),
        virtualAccount:
          payment.portone_status === "VIRTUAL_ACCOUNT_ISSUED" &&
          payment.vbank_num
            ? {
                accountNumber: payment.vbank_num,
                bank: payment.vbank_bank,
                dueAt: payment.vbank_due,
              }
            : null,
      };
    })(),
    commerce_order_items: order.commerce_order_items?.map((item) => item.products ? {
      ...item,
      products: { ...item.products, image_urls: item.products.image_urls.map((image) => getCatalogImageUrl(image, 320)) },
    } : item),
  })) });
}
