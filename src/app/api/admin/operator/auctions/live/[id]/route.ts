import { authenticateOperatorStoreRequest, commerceJson, verifyOperatorProductScope } from "@/lib/commerce/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["extend_10", "extend_30", "close_now", "cancel_bid", "block_bidder"]);

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
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { action?: unknown; bidId?: unknown; bidderId?: unknown; reason?: unknown; blockMinutes?: unknown } | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!UUID_PATTERN.test(id) || !ACTIONS.has(action) || reason.length < 2 || reason.length > 500) return commerceJson({ error: "invalid_auction_action", message: "작업과 사유를 확인해 주세요." }, 422);
  const scopeError = await verifyOperatorProductScope(auth.user, auth.selectedStoreId, id);
  if (scopeError) return scopeError;

  let result: unknown;
  let error: { code?: string; message?: string } | null = null;
  if (action === "extend_10" || action === "extend_30") {
    ({ data: result, error } = await auth.user.rpc("operator_extend_live_auction", { p_product_id: id, p_minutes: action === "extend_10" ? 10 : 30, p_reason: reason }));
  } else if (action === "close_now") {
    ({ data: result, error } = await auth.user.rpc("operator_close_live_auction", { p_product_id: id, p_reason: reason }));
  } else if (action === "cancel_bid") {
    if (!UUID_PATTERN.test(String(body?.bidId ?? ""))) return commerceJson({ error: "invalid_bid" }, 422);
    const { data: bid } = await auth.admin.from("auction_bids").select("id").eq("id", String(body?.bidId)).eq("product_id", id).maybeSingle();
    if (!bid) return commerceJson({ error: "bid_not_found", message: "최신 입찰 목록을 다시 확인해 주세요." }, 409);
    ({ data: result, error } = await auth.user.rpc("operator_cancel_auction_bid", { p_bid_id: bid.id, p_reason: reason }));
  } else {
    const minutes = Number(body?.blockMinutes);
    const bidderId = String(body?.bidderId ?? "");
    if (!UUID_PATTERN.test(bidderId) || ![30, 60, 180, 1440].includes(minutes)) return commerceJson({ error: "invalid_bid_block" }, 422);
    const { data: bid } = await auth.admin.from("auction_bids").select("id").eq("product_id", id).eq("bidder_id", bidderId).limit(1).maybeSingle();
    if (!bid) return commerceJson({ error: "bidder_not_found", message: "현재 경매 참여자를 확인해 주세요." }, 409);
    ({ data: result, error } = await auth.user.rpc("manage_member_sanction", { p_action: "create", p_member_id: bidderId, p_starts_at: new Date().toISOString(), p_ends_at: new Date(Date.now() + minutes * 60_000).toISOString(), p_reason: reason }));
  }
  if (error) return commerceJson({ error: error.code ?? "auction_action_failed", message: error.message ?? "경매 작업을 완료하지 못했습니다." }, error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 409);
  return commerceJson({ result });
}
