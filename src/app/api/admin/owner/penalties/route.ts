import { authenticateOwnerAccessRequest, ownerAccessErrorResponse, ownerAccessJsonResponse, readSmallJsonBody } from "@/lib/ownerAccess/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;

export async function GET(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const transferResult = await access.admin.from("manual_transfer_orders").select("id,buyer_id,expected_amount,due_at,status,product_id").in("status", ["awaiting_manual_transfer", "awaiting_transfer", "partially_paid"]).not("buyer_id", "is", null).order("due_at", { ascending: true }).limit(500);
    if (transferResult.error) return ownerAccessJsonResponse({ error: "penalty_queue_unavailable" }, 503);
    const transfers = transferResult.data ?? [];
    const memberIds = [...new Set(transfers.flatMap((row) => row.buyer_id ? [row.buyer_id] : []))];
    const productIds = [...new Set(transfers.map((row) => row.product_id))];
    const [profileResult, productResult] = await Promise.all([
      memberIds.length ? access.admin.from("profiles").select("id,display_name").in("id", memberIds) : Promise.resolve({ data: [], error: null }),
      productIds.length ? access.admin.from("products").select("id,title").in("id", productIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (profileResult.error || productResult.error) return ownerAccessJsonResponse({ error: "penalty_queue_unavailable" }, 503);
    const nameById = new Map((profileResult.data ?? []).map((row) => [row.id, row.display_name]));
    const titleById = new Map((productResult.data ?? []).map((row) => [row.id, row.title]));
    type Entry = { memberId: string; displayName: string; unpaidCount: number; unpaidAmount: number; oldestDueAt: string | null; products: string[] };
    const grouped = new Map<string, Entry>();
    for (const row of transfers) {
      if (!row.buyer_id) continue;
      const current: Entry = grouped.get(row.buyer_id) ?? { memberId: row.buyer_id, displayName: nameById.get(row.buyer_id) ?? "회원", unpaidCount: 0, unpaidAmount: 0, oldestDueAt: null, products: [] };
      current.unpaidCount += 1;
      current.unpaidAmount += Number(row.expected_amount);
      if (row.due_at && (!current.oldestDueAt || row.due_at < current.oldestDueAt)) current.oldestDueAt = row.due_at;
      const title = titleById.get(row.product_id);
      if (title) current.products.push(title);
      grouped.set(row.buyer_id, current);
    }
    return ownerAccessJsonResponse({ members: [...grouped.values()] });
  } catch (error) { return ownerAccessErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const body = await readSmallJsonBody(request);
    const memberId = typeof body.memberId === "string" && UUID_PATTERN.test(body.memberId) ? body.memberId : null;
    const duration = typeof body.duration === "string" ? body.duration : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!memberId || !["3d", "7d", "permanent"].includes(duration) || reason.length < 3) return ownerAccessJsonResponse({ error: "invalid_penalty_request", message: "제재 기간과 사유를 확인해 주세요." }, 422);
    const { data, error } = await access.userClient.rpc("owner_apply_bid_penalty", { p_member_id: memberId, p_duration: duration, p_reason: reason });
    if (error) return ownerAccessJsonResponse({ error: "penalty_failed", message: error.message }, error.code === "42501" ? 403 : 422);
    return ownerAccessJsonResponse({ penalty: data });
  } catch (error) { return ownerAccessErrorResponse(error); }
}
