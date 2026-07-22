import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;

  const { id } = await params;
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
