import { authenticateMemberRlsRequest, commerceJson } from "@/lib/commerce/server";
import { ACTIVE_COMMERCE_PAYMENT_MODE } from "@/lib/commerce/paymentMode";
import { getCatalogImageUrl } from "@/lib/images";
import { getManualTransferAccount } from "@/lib/manualTransferConfig";
import { enforceCartRateLimit } from "@/lib/ratelimit/server";
import { createSupabaseServerClients } from "@/lib/supabase/server";
import { mapPublishedProduct } from "@/services/products";

type ShippingQuote = {
  productSubtotal: number;
  shippingFee: number;
  total: number;
  chargeCount: number;
  charges: Array<{
    chargeKey: string;
    mode: "per_store" | "per_group";
    groupId: string | null;
    groupName: string | null;
    unitKind: "store" | "fulfillment_group";
    unitName: string;
    billingStoreId: string;
    billingStoreName: string;
    amount: number;
    productSubtotal: number;
    productIds: string[];
    products: Array<{ id: string; title: string; amount: number }>;
    storeIds: string[];
    storeNames: string[];
  }>;
};

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message?: string } | null;
  }>;
};

export async function GET(request: Request) {
  const auth = await authenticateMemberRlsRequest(request);
  if (!auth.ok) return auth.response;
  const { admin } = createSupabaseServerClients();
  const { data, error } = await auth.user.rpc("get_my_cart_reservations");
  if (error) return commerceJson({ error: "cart_unavailable" }, 503);
  try {
    await getManualTransferAccount(admin);
  } catch {
    return commerceJson({ error: "payment_status_unavailable" }, 503);
  }
  const paymentMode = ACTIVE_COMMERCE_PAYMENT_MODE;
  const reservations = data ?? [];
  const ids = reservations.map((item) => item.product_id);
  if (ids.length === 0) {
    return commerceJson({
      items: [],
      paymentMode,
      productIds: [],
      reservations: [],
      serverTime: null,
      shippingFee: 0,
      shippingCharges: [],
    });
  }
  const { data: products, error: productError } = await auth.user
    .from("products")
    .select("*,stores(name,slug)")
    .in("id", ids)
    .eq("sale_type", "fixed")
    .eq("status", "active")
    .lte("publish_at", new Date().toISOString());
  if (productError) return commerceJson({ error: "cart_unavailable" }, 503);
  const liveIds = (products ?? []).map((product) => product.id);
  const quoteResult = await (auth.user as unknown as RpcClient).rpc(
    "quote_commerce_shipping_fee",
    { p_product_ids: liveIds },
  );
  if (quoteResult.error || !quoteResult.data || typeof quoteResult.data !== "object") {
    return commerceJson({ error: "shipping_fee_unavailable" }, 503);
  }
  const quote = quoteResult.data as ShippingQuote;
  const shippingFee = Number(quote.shippingFee);
  const chargesAreValid = Array.isArray(quote.charges) && quote.charges.length > 0 &&
    quote.charges.every((charge) =>
      charge && typeof charge.chargeKey === "string" &&
      (charge.unitKind === "store" || charge.unitKind === "fulfillment_group") &&
      typeof charge.unitName === "string" && Boolean(charge.unitName.trim()) &&
      typeof charge.billingStoreName === "string" && Boolean(charge.billingStoreName.trim()) &&
      Number.isSafeInteger(Number(charge.amount)) && Number(charge.amount) > 0 &&
      Number.isSafeInteger(Number(charge.productSubtotal)) && Number(charge.productSubtotal) > 0 &&
      Array.isArray(charge.storeIds) && charge.storeIds.length > 0 &&
      Array.isArray(charge.productIds) && charge.productIds.length > 0 &&
      Array.isArray(charge.products) && charge.products.length === charge.productIds.length,
    );
  if (!Number.isSafeInteger(shippingFee) || shippingFee < 1 || !chargesAreValid) {
    return commerceJson({ error: "shipping_fee_unavailable" }, 503);
  }
  const reservationByProduct = new Map(
    reservations.map((reservation) => [
      reservation.product_id,
      reservation.reserved_until,
    ]),
  );
  const items = (products ?? [])
    .map(mapPublishedProduct)
    .map((product) => ({
      ...product,
      imageUrls: product.imageUrls.map((image) => getCatalogImageUrl(image)),
      thumbnailUrls: product.thumbnailUrls.map((image) =>
        getCatalogImageUrl(image, 320),
      ),
      reservationExpiresAt: reservationByProduct.get(product.id) ?? null,
    }));
  return commerceJson({
    items,
    paymentMode,
    productIds: liveIds,
    reservations: reservations.map((reservation) => ({
      productId: reservation.product_id,
      reservedUntil: reservation.reserved_until,
    })),
    serverTime: reservations[0]?.server_time ?? null,
    shippingFee,
    shippingCharges: Array.isArray(quote.charges) ? quote.charges : [],
    quoteTotal: Number(quote.total),
    staleProductIds: ids.filter((id) => !liveIds.includes(id)),
  });
}

export async function POST(request: Request) {
  const auth = await authenticateMemberRlsRequest(request, true);
  if (!auth.ok) return auth.response;
  const rateLimit = await enforceCartRateLimit(request, auth.userId);
  if (!rateLimit.ok) return rateLimit.response;
  const body = await request.json().catch(() => null) as { productId?: string } | null;
  if (!body?.productId) return commerceJson({ error: "상품을 선택해 주세요." }, 400);

  const { data, error } = await auth.user
    .rpc("reserve_fixed_product_for_cart", {
      p_product_id: body.productId,
    })
    .single();
  if (error) {
    const status = error.code === "22023"
      ? 400
      : error.code === "42501"
        ? 403
        : error.code === "P0002"
          ? 404
          : ["23505", "P0001"].includes(error.code ?? "")
            ? 409
            : 503;
    return commerceJson(
      { error: error.message || "cart_update_failed" },
      status,
    );
  }
  if (!data) return commerceJson({ error: "cart_update_failed" }, 503);
  return commerceJson({
    productId: data.product_id,
    reservedUntil: data.reserved_until,
    serverTime: data.server_time,
  }, 201);
}

export async function DELETE(request: Request) {
  const auth = await authenticateMemberRlsRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as { productId?: string } | null;
  if (!body?.productId) return commerceJson({ error: "상품을 선택해 주세요." }, 400);
  const { data, error } = await auth.user.rpc(
    "release_my_cart_reservation",
    { p_product_id: body.productId },
  );
  if (error) return commerceJson({ error: "cart_update_failed" }, 503);
  return commerceJson({
    removed: data,
    removedProductId: body.productId,
  });
}
