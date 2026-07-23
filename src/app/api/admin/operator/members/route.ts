import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

type RpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message?: string } | null;
  }>;
};

function errorMessage(error: { message?: string } | null, fallback: string) {
  return error?.message || fallback;
}

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "operator") return commerceJson({ error: "forbidden" }, 403);
  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 200)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
  const rpc = auth.user as unknown as RpcClient;
  const { data, error } = await rpc.rpc("get_operator_member_directory", { p_limit: limit, p_offset: offset });
  if (error) return commerceJson({ error: errorMessage(error, "하위 계정 목록을 불러오지 못했습니다.") }, 503);
  return commerceJson({ members: data ?? [], roleCode: auth.roleCode, limit, offset });
}

export async function PATCH(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "operator") return commerceJson({ error: "forbidden" }, 403);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const memberId = typeof body?.memberId === "string" ? body.memberId : "";
  const action = typeof body?.action === "string" ? body.action : "";
  if (!memberId) return commerceJson({ error: "대상을 선택해 주세요." }, 400);
  const rpc = auth.user as unknown as RpcClient;

  if (action === "role") {
    const roleCode = typeof body?.roleCode === "string" ? body.roleCode : "";
    if (!["employee", "band_member", "member"].includes(roleCode)) return commerceJson({ error: "하위 역할을 확인해 주세요." }, 400);
    const { data, error } = await rpc.rpc("set_member_access_role", { p_member_id: memberId, p_role_code: roleCode });
    if (error) return commerceJson({ error: errorMessage(error, "역할을 변경하지 못했습니다.") }, 403);
    return commerceJson({ memberId, access_role: data });
  }

  if (action === "warning") {
    const category = typeof body?.category === "string" ? body.category.trim() : "";
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!category || !reason) return commerceJson({ error: "경고 분류와 사유를 입력해 주세요." }, 400);
    const { data, error } = await rpc.rpc("add_member_warning", { p_member_id: memberId, p_category: category, p_reason: reason });
    if (error) return commerceJson({ error: errorMessage(error, "경고를 등록하지 못했습니다.") }, 403);
    return commerceJson({ memberId, enforcement: data });
  }

  if (["sanction_create", "sanction_update", "sanction_cancel"].includes(action)) {
    const { data, error } = await rpc.rpc("manage_member_sanction", {
      p_action: action.replace("sanction_", ""),
      p_member_id: memberId,
      p_sanction_id: typeof body?.sanctionId === "string" ? body.sanctionId : null,
      p_starts_at: typeof body?.startsAt === "string" ? body.startsAt : null,
      p_ends_at: typeof body?.endsAt === "string" ? body.endsAt : null,
      p_reason: typeof body?.reason === "string" ? body.reason : null,
    });
    if (error) return commerceJson({ error: errorMessage(error, "제재를 변경하지 못했습니다.") }, 403);
    return commerceJson({ memberId, sanction: data });
  }

  return commerceJson({ error: "지원하지 않는 하위 계정 작업입니다." }, 400);
}
