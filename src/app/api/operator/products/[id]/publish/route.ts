import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { data, error } = await auth.user.rpc("publish_pending_products_now", { p_product_ids: [id] });
  if (error) return commerceJson({ error: error.message || "상품을 공개하지 못했습니다." }, 409);
  return commerceJson({ result: data });
}
