import { authenticateMemberRlsRequest, commerceJson } from "@/lib/commerce/server";
import { getCatalogImageUrl } from "@/lib/images";
import { mapPublishedProduct } from "@/services/products";

export async function GET(request: Request) {
  const auth = await authenticateMemberRlsRequest(request);
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.user.rpc("get_my_cart_reservations");
  if (error) return commerceJson({ error: "cart_unavailable" }, 503);
  const { data: paymentRows, error: paymentStatusError } = await auth.user.rpc(
    "get_commerce_payment_status",
  );
  const paymentStatus = Array.isArray(paymentRows)
    ? paymentRows[0]
    : paymentRows;
  if (
    paymentStatusError ||
    !paymentStatus ||
    (paymentStatus.active_mode !== "manual_transfer" &&
      paymentStatus.active_mode !== "portone")
  ) {
    return commerceJson({ error: "payment_status_unavailable" }, 503);
  }
  const paymentMode = paymentStatus.active_mode;
  const reservations = data ?? [];
  const ids = reservations.map((item) => item.product_id);
  if (ids.length === 0) {
    return commerceJson({
      items: [],
      paymentMode,
      productIds: [],
      reservations: [],
      serverTime: null,
    });
  }
  const { data: products, error: productError } = await auth.user
    .from("products")
    .select("*")
    .in("id", ids)
    .eq("sale_type", "fixed")
    .eq("status", "active")
    .lte("publish_at", new Date().toISOString());
  if (productError) return commerceJson({ error: "cart_unavailable" }, 503);
  const liveIds = (products ?? []).map((product) => product.id);
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
    staleProductIds: ids.filter((id) => !liveIds.includes(id)),
  });
}

export async function POST(request: Request) {
  const auth = await authenticateMemberRlsRequest(request, true);
  if (!auth.ok) return auth.response;
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
