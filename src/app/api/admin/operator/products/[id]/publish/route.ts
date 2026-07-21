import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner" && auth.roleCode !== "operator") {
    return commerceJson({ error: "forbidden" }, 403);
  }

  const { id } = await params;
  const { data: product, error: productError } = await auth.admin
    .from("products")
    .select("id, store_id, status")
    .eq("id", id)
    .maybeSingle();
  if (productError) return commerceJson({ error: "product_unavailable" }, 503);
  if (!product) return commerceJson({ error: "product_not_found" }, 404);

  if (auth.roleCode !== "owner") {
    if (!product.store_id) return commerceJson({ error: "forbidden" }, 403);
    const { data: store, error: storeError } = await auth.admin
      .from("stores")
      .select("operator_id")
      .eq("id", product.store_id)
      .maybeSingle();
    if (storeError) return commerceJson({ error: "store_unavailable" }, 503);
    if (store?.operator_id !== auth.userId) return commerceJson({ error: "forbidden" }, 403);
  }

  if (product.status !== "pending") {
    return commerceJson({ error: "product_not_pending" }, 409);
  }

  const { data, error } = await auth.user
    .rpc("publish_pending_products_now", { p_product_ids: [id] })
    .single();
  if (error) return commerceJson({ error: error.message || "상품을 공개하지 못했습니다." }, 409);
  if (!data) return commerceJson({ error: "publish_result_unavailable" }, 409);

  const publishedIds = Array.isArray(data.published_ids) ? data.published_ids : [];
  const skippedIds = Array.isArray(data.skipped_ids) ? data.skipped_ids : [];
  const published = data.requested_count === 1
    && data.published_count === 1
    && data.skipped_count === 0
    && publishedIds.includes(id)
    && !skippedIds.includes(id);
  if (!published) {
    return commerceJson({ error: "product_not_published", result: data }, 409);
  }

  return commerceJson({ result: data });
}
