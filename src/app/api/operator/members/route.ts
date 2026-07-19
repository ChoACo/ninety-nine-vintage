import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

function errorMessage(error: { message?: string } | null, fallback: string) {
  return error?.message || fallback;
}

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 200)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
  const { data, error } = await auth.user.rpc("get_staff_member_directory", { p_limit: limit, p_offset: offset });
  if (error) return commerceJson({ error: errorMessage(error, "회원 목록을 불러오지 못했습니다.") }, 503);
  return commerceJson({ members: data ?? [], limit, offset });
}

export async function PATCH(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const memberId = typeof body?.memberId === "string" ? body.memberId : "";
  const action = typeof body?.action === "string" ? body.action : "";
  if (!memberId) return commerceJson({ error: "회원을 선택해 주세요." }, 400);

  if (action === "status") {
    const status = body?.status === "suspended" ? "suspended" : body?.status === "active" ? "active" : "";
    if (!status) return commerceJson({ error: "회원 상태를 확인해 주세요." }, 400);
    const { data, error } = await auth.user.rpc("set_member_account_status", { p_member_id: memberId, p_status: status });
    if (error) return commerceJson({ error: errorMessage(error, "회원 상태를 변경하지 못했습니다.") }, 403);
    return commerceJson({ memberId, status: data });
  }

  if (action === "credits") {
    const delta = Number(body?.delta);
    if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 100) return commerceJson({ error: "배송 이용권 변경 수를 확인해 주세요." }, 400);
    const { data, error } = await auth.user.rpc("adjust_member_shipping_credits", { p_member_id: memberId, p_delta: delta });
    if (error) return commerceJson({ error: errorMessage(error, "배송 이용권을 변경하지 못했습니다.") }, 403);
    return commerceJson({ memberId, shipping_credit_count: data });
  }

  if (action === "role") {
    const roleCode = typeof body?.roleCode === "string" ? body.roleCode : "";
    if (!["operator", "employee", "band_member", "member"].includes(roleCode)) return commerceJson({ error: "회원 등급을 확인해 주세요." }, 400);
    const { data, error } = await auth.user.rpc("set_member_access_role", { p_member_id: memberId, p_role_code: roleCode });
    if (error) return commerceJson({ error: errorMessage(error, "회원 등급을 변경하지 못했습니다.") }, 403);
    return commerceJson({ memberId, access_role: data });
  }

  if (action === "profile") {
    const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
    const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
    if (!displayName) return commerceJson({ error: "회원명을 입력해 주세요." }, 400);
    const { error } = await auth.user.rpc("update_managed_member", { p_member_id: memberId, p_display_name: displayName, p_phone: phone });
    if (error) return commerceJson({ error: errorMessage(error, "회원 정보를 변경하지 못했습니다.") }, 403);
    return commerceJson({ memberId, updated: true });
  }

  return commerceJson({ error: "지원하지 않는 회원 관리 작업입니다." }, 400);
}
