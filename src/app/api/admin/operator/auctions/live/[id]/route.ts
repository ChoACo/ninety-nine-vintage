import { authenticateOperatorStoreRequest, commerceJson, verifyOperatorProductScope } from "@/lib/commerce/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateOperatorStoreRequest(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return commerceJson({ error: "invalid_product" }, 422);
  const scopeError = await verifyOperatorProductScope(auth.user, auth.selectedStoreId, id);
  if (scopeError) return scopeError;
  const [{ data: product, error: productError }, { data: bids, error: bidError }] = await Promise.all([
    auth.admin.from("products").select("id,title,status,current_price,closes_at").eq("id", id).single(),
    auth.admin.from("auction_bids").select("id,bidder_id,bidder_display_name,amount,created_at,is_final").eq("product_id", id).order("amount", { ascending: false }).order("created_at").limit(100),
  ]);
  if (productError || bidError || !product) return commerceJson({ error: "auction_monitor_unavailable", message: "실시간 경매 기록을 불러오지 못했습니다." }, 503);
  return commerceJson({ product, bids: bids ?? [] });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateOperatorStoreRequest(request, true);
  if (!auth.ok) return auth.response;
  void request;
  void context;
  return commerceJson({
    error: "operator_live_auction_mutation_forbidden",
    message: "운영자는 진행 중 경매를 연장·즉시 마감하거나 입찰을 취소할 수 없습니다.",
  }, 403);
}
