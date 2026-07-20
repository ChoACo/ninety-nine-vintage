import {
  authenticateMemberRlsRequest,
  commerceJson,
} from "@/lib/commerce/server";
import { getCatalogImageUrl } from "@/lib/images";
import {
  isPortOnePayMethod,
  isValidPaymentId,
} from "@/lib/portone/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RETRYABLE_PORTONE_STATUSES = new Set([
  "READY",
  "FAILED",
  "CANCELLED",
]);

function relatedRow<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function commerceCondition(value: string): "NEW" | "EXCELLENT" | "GOOD" | "FAIR" {
  if (value === "S") return "NEW";
  if (value === "A+") return "EXCELLENT";
  if (value === "B") return "FAIR";
  return "GOOD";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateMemberRlsRequest(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return commerceJson({ error: "invalid_order_id" }, 400);
  }

  // The buyer-scoped RLS session reads only its own order. The companion
  // migration grants that buyer access to product snapshots after inventory is
  // closed, so recovery does not require a privileged service client.
  const { data: order, error: orderError } = await auth.user
    .from("commerce_orders")
    .select(
      "id, member_id, status, total, idempotency_key, commerce_order_items(id, product_id, unit_price, payment_status, products(id, title, category, size_label, condition_grade, closes_at, sale_type, image_urls), stores(name))",
    )
    .eq("id", id)
    .eq("member_id", auth.userId)
    .maybeSingle();
  if (orderError) return commerceJson({ error: "order_unavailable" }, 503);
  if (!order) return commerceJson({ error: "order_not_found" }, 404);

  const { data: payment, error: paymentError } = await auth.user
    .from("payment_orders")
    .select(
      "commerce_order_id, buyer_id, payment_id, requested_method, expected_amount, currency, portone_status, paid_at",
    )
    .eq("commerce_order_id", order.id)
    .eq("buyer_id", auth.userId)
    .maybeSingle();
  if (paymentError) {
    return commerceJson({ error: "order_unavailable" }, 503);
  }

  const items = order.commerce_order_items ?? [];
  const productSnapshots = items.map((item) => {
    const product = relatedRow(item.products);
    const store = relatedRow(item.stores);
    if (
      !product ||
      product.id !== item.product_id ||
      product.sale_type !== "fixed" ||
      !Number.isSafeInteger(item.unit_price) ||
      item.unit_price <= 0 ||
      item.payment_status !== "awaiting_payment"
    ) {
      return null;
    }
    return {
      id: item.product_id,
      title: product.title,
      category: product.category,
      size: product.size_label || "사이즈 미등록",
      condition: commerceCondition(product.condition_grade),
      saleType: "fixed" as const,
      // The immutable order item price is authoritative for recovery display.
      price: item.unit_price,
      closesAt: product.closes_at,
      store: { name: store?.name || "NINETY-NINE VINTAGE" },
      imageUrls: product.image_urls.map((image) => getCatalogImageUrl(image, 640)),
    };
  });
  const productIds = items.map((item) => item.product_id);
  const portoneStatus = payment?.portone_status ?? null;
  const canResume = Boolean(
    payment &&
      order.status === "awaiting_payment" &&
      payment.commerce_order_id === order.id &&
      payment.buyer_id === auth.userId &&
      payment.paid_at === null &&
      payment.expected_amount === order.total &&
      payment.currency === "KRW" &&
      isValidPaymentId(payment.payment_id) &&
      isPortOnePayMethod(payment.requested_method) &&
      (portoneStatus === null || RETRYABLE_PORTONE_STATUSES.has(portoneStatus)) &&
      items.length > 0 &&
      items.length <= 50 &&
      new Set(productIds).size === items.length &&
      productSnapshots.every((snapshot) => snapshot !== null),
  );

  return commerceJson({
    order: { id: order.id, status: order.status, total: order.total },
    recovery: canResume
      ? {
          buyerId: auth.userId,
          idempotencyKey: order.idempotency_key,
          paymentId: payment!.payment_id,
          payMethod: payment!.requested_method,
          productIds,
          productSnapshots,
        }
      : null,
    storagePolicy: { smallDays: 14, largeDays: 7 },
  });
}
