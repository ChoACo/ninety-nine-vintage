import { authenticateOwnerAccessRequest, ownerAccessErrorResponse, ownerAccessJsonResponse, ownerRpc, readSmallJsonBody } from "@/lib/ownerAccess/server";

export async function GET(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const [stateResult, activeAuctionResult] = await Promise.all([
      access.userClient
        .from("auction_emergency_control")
        .select("paused,paused_at,reason,updated_at,updated_by")
        .eq("singleton", true)
        .single(),
      access.admin
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("sale_type", "auction")
        .eq("status", "active"),
    ]);
    if (stateResult.error || activeAuctionResult.error) {
      return ownerAccessJsonResponse(
        { error: "auction_emergency_state_unavailable" },
        503,
      );
    }
    return ownerAccessJsonResponse({
      ...stateResult.data,
      activeAuctionCount: activeAuctionResult.count ?? 0,
    });
  } catch (error) { return ownerAccessErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const body = await readSmallJsonBody(request);
    const action = typeof body.action === "string" ? body.action : "";
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (!new Set(["pause", "resume", "extend_60"]).has(action) || body.keyword !== "CONFIRM" || reason.length < 2) return ownerAccessJsonResponse({ error: "invalid_emergency_action", message: "CONFIRM 키워드와 사유를 확인해 주세요." }, 422);
    const result = await ownerRpc<Record<string, unknown>>(access, "owner_control_all_auctions", { p_action: action, p_reason: reason });
    return ownerAccessJsonResponse({ result });
  } catch (error) { return ownerAccessErrorResponse(error); }
}
