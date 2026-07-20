import { authenticateMemberCommerceRequest, commerceJson } from "@/lib/commerce/server";

export async function GET(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request);
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.user
    .from("wishlist_items")
    .select("product_id, created_at")
    .order("created_at", { ascending: false });
  if (error) return commerceJson({ error: "wishlist_unavailable" }, 503);
  return commerceJson({ productIds: (data ?? []).map((item) => item.product_id), items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as { productId?: string } | null;
  if (!body?.productId) return commerceJson({ error: "상품을 선택해 주세요." }, 400);
  const { data: product } = await auth.admin
    .from("products")
    .select("id")
    .eq("id", body.productId)
    .eq("status", "active")
    .maybeSingle();
  if (!product) return commerceJson({ error: "상품을 찾을 수 없습니다." }, 404);
  const { error } = await auth.user.from("wishlist_items").upsert(
    { member_id: auth.userId, product_id: body.productId },
    { onConflict: "member_id,product_id" },
  );
  if (error) return commerceJson({ error: "wishlist_update_failed" }, 503);
  return commerceJson({ productId: body.productId, liked: true }, 201);
}

export async function DELETE(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as { productId?: string } | null;
  if (!body?.productId) return commerceJson({ error: "상품을 선택해 주세요." }, 400);
  const { error } = await auth.user
    .from("wishlist_items")
    .delete()
    .eq("member_id", auth.userId)
    .eq("product_id", body.productId);
  if (error) return commerceJson({ error: "wishlist_update_failed" }, 503);
  return commerceJson({ productId: body.productId, liked: false });
}
