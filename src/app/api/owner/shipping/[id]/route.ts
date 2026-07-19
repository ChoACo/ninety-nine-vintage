import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateStaffRequest(request, true); if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") return commerceJson({ error: "forbidden" }, 403);
  const { id } = await params; const body = await request.json().catch(() => null) as { courier?: string; trackingNumber?: string } | null;
  if (!body?.courier?.trim() || !body.trackingNumber?.trim()) return commerceJson({ error: "택배사와 운송장 번호를 입력해 주세요." }, 400);
  const { data, error } = await auth.admin.from("shipping_requests").update({ courier: body.courier.trim(), tracking_number: body.trackingNumber.trim(), status: "shipped", shipped_at: new Date().toISOString() }).eq("id", id).select("*").maybeSingle();
  if (error) return commerceJson({ error: error.message || "배송 상태를 변경하지 못했습니다." }, 409);
  if (!data) return commerceJson({ error: "배송 요청을 찾지 못했습니다." }, 404);
  return commerceJson({ request: data });
}
