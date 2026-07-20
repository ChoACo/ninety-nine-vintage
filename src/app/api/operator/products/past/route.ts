import { authenticateStaffRequest, commerceJson, normalizeIds } from "@/lib/commerce/server";
import { getCatalogImageUrl } from "@/lib/images";

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  let storeQuery = auth.admin.from("stores").select("id, name, slug, operator_id").eq("is_active", true);
  if (auth.roleCode !== "owner") storeQuery = storeQuery.eq("operator_id", auth.userId);
  const { data: stores, error: storeError } = await storeQuery.order("name");
  if (storeError) return commerceJson({ error: "past_products_unavailable" }, 503);
  const storeIds = (stores ?? []).map((store) => store.id);
  if (storeIds.length === 0) return commerceJson({ stores: [], products: [] });
  const { data, error } = await auth.admin
    .from("products")
    .select("*, stores(id, name, slug)")
    .eq("sale_type", "auction")
    .eq("past_action", "pending")
    .gt("past_expires_at", new Date().toISOString())
    .in("store_id", storeIds)
    .order("past_at", { ascending: false });
  if (error) return commerceJson({ error: "past_products_unavailable" }, 503);
  return commerceJson({
    stores: stores ?? [],
    products: (data ?? []).map((product) => ({
      ...product,
      image_urls: product.image_urls.map((image) => getCatalogImageUrl(image, 320)),
      thumbnail_urls: product.thumbnail_urls.map((image) => getCatalogImageUrl(image, 320)),
    })),
  });
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const productIds = normalizeIds(body?.productIds);
  const action = body?.action === "delete" ? "delete" : body?.action === "relist" ? "relist" : "";
  if (productIds.length === 0 || productIds.length > 200 || !action) {
    return commerceJson({ error: "상품과 작업을 확인해 주세요." }, 400);
  }
  const { data, error } = await auth.user.rpc("manage_past_auction_products", {
    p_product_ids: productIds,
    p_action: action,
  }).single();
  if (error) return commerceJson({ error: error.message || "지난 상품을 처리하지 못했습니다." }, 409);
  return commerceJson({ result: data });
}
