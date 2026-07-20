import { authenticateMemberRlsRequest, commerceJson } from "@/lib/commerce/server";
import { getCatalogImageUrl } from "@/lib/images";
import { mapPublishedProduct } from "@/services/products";

export async function GET(request: Request) {
  const auth = await authenticateMemberRlsRequest(request);
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.user
    .from("cart_items")
    .select("product_id, created_at")
    .order("created_at", { ascending: false });
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
  const ids = (data ?? []).map((item) => item.product_id);
  if (ids.length === 0) {
    return commerceJson({
      items: [],
      paymentMode,
      productIds: [],
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
  const items = (products ?? []).map(mapPublishedProduct).map((product) => ({
    ...product,
    imageUrls: product.imageUrls.map((image) => getCatalogImageUrl(image)),
    thumbnailUrls: product.thumbnailUrls.map((image) =>
      getCatalogImageUrl(image, 320),
    ),
  }));
  return commerceJson({
    items,
    paymentMode,
    productIds: liveIds,
    staleProductIds: ids.filter((id) => !liveIds.includes(id)),
  });
}

export async function POST(request: Request) {
  const auth = await authenticateMemberRlsRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as { productId?: string } | null;
  if (!body?.productId) return commerceJson({ error: "상품을 선택해 주세요." }, 400);

  const { data: product, error: productError } = await auth.user
    .from("products")
    .select("id")
    .eq("id", body.productId)
    .eq("sale_type", "fixed")
    .eq("status", "active")
    .lte("publish_at", new Date().toISOString())
    .maybeSingle();
  if (productError) return commerceJson({ error: "cart_unavailable" }, 503);
  if (!product) return commerceJson({ error: "현재 구매할 수 없는 상품입니다." }, 409);

  const { error } = await auth.user.from("cart_items").upsert(
    { member_id: auth.userId, product_id: body.productId },
    { onConflict: "member_id,product_id" },
  );
  if (error) return commerceJson({ error: "cart_update_failed" }, 503);
  return commerceJson({ productId: body.productId }, 201);
}

export async function DELETE(request: Request) {
  const auth = await authenticateMemberRlsRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as { productId?: string } | null;
  if (!body?.productId) return commerceJson({ error: "상품을 선택해 주세요." }, 400);
  const { error } = await auth.user
    .from("cart_items")
    .delete()
    .eq("member_id", auth.userId)
    .eq("product_id", body.productId);
  if (error) return commerceJson({ error: "cart_update_failed" }, 503);
  return commerceJson({ removedProductId: body.productId });
}
