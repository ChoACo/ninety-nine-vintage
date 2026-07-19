import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.user.rpc("get_shipping_work", { p_include_shipped: false, p_limit: 100, p_offset: 0 });
  if (error) return commerceJson({ error: error.message || "배송 목록을 불러오지 못했습니다." }, 503);
  return commerceJson({ requests: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as { requestId?: string; courier?: string; trackingNumber?: string } | null;
  if (!body?.requestId || !body.courier?.trim() || !body.trackingNumber?.trim()) return commerceJson({ error: "택배사와 운송장 번호를 입력해 주세요." }, 400);
  const { data, error } = await auth.user.rpc("mark_shipping_request_shipped", { p_request_id: body.requestId, p_courier: body.courier.trim(), p_tracking_number: body.trackingNumber.trim() });
  if (error) return commerceJson({ error: error.message || "배송 상태를 변경하지 못했습니다." }, 409);
  return commerceJson({ request: data });
}
