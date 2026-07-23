import { authenticateOwnerAccessRequest, ownerAccessErrorResponse, ownerAccessJsonResponse, readSmallJsonBody } from "@/lib/ownerAccess/server";

function rpcError(error: { message?: string } | null, fallback: string) {
  return ownerAccessJsonResponse({ error: fallback, message: error?.message ?? fallback }, 403);
}

export async function GET(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const url = new URL(request.url);
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 200)));
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
    const { data, error } = await access.userClient.rpc("get_manager_member_directory", { p_limit: limit, p_offset: offset });
    if (error) return rpcError(error, "member_directory_unavailable");
    return ownerAccessJsonResponse({ members: data ?? [], limit, offset });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const body = await readSmallJsonBody(request);
    const memberId = typeof body.memberId === "string" ? body.memberId : "";
    const action = typeof body.action === "string" ? body.action : "";
    if (!memberId) return ownerAccessJsonResponse({ error: "invalid_member" }, 400);

    if (action === "role") {
      const roleCode = typeof body.roleCode === "string" ? body.roleCode : "";
      if (!["operator", "employee", "band_member", "member"].includes(roleCode)) return ownerAccessJsonResponse({ error: "invalid_role" }, 400);
      const { data, error } = await access.userClient.rpc("set_member_access_role", { p_member_id: memberId, p_role_code: roleCode });
      if (error) return rpcError(error, "role_update_failed");
      return ownerAccessJsonResponse({ memberId, accessRole: data });
    }
    if (action === "status") {
      const status = typeof body.status === "string" ? body.status : "";
      const { data, error } = await access.userClient.rpc("set_managed_member_status", {
        p_member_id: memberId,
        p_status: status,
        p_suspended_until: typeof body.suspendedUntil === "string" ? body.suspendedUntil : null,
        p_reason: typeof body.reason === "string" ? body.reason : null,
      });
      if (error) return rpcError(error, "status_update_failed");
      return ownerAccessJsonResponse({ member: data });
    }
    if (action === "profile") {
      const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
      const phone = typeof body.phone === "string" ? body.phone.trim() : "";
      const { error } = await access.userClient.rpc("update_managed_member", { p_member_id: memberId, p_display_name: displayName, p_phone: phone });
      if (error) return rpcError(error, "profile_update_failed");
      return ownerAccessJsonResponse({ memberId, updated: true });
    }
    if (action === "credits") {
      const delta = Number(body.delta);
      if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 100) return ownerAccessJsonResponse({ error: "invalid_delta" }, 400);
      const { data, error } = await access.userClient.rpc("adjust_member_shipping_credits", { p_member_id: memberId, p_delta: delta });
      if (error) return rpcError(error, "credits_update_failed");
      return ownerAccessJsonResponse({ memberId, shippingCreditCount: data });
    }
    if (action === "warning") {
      const { data, error } = await access.userClient.rpc("add_member_warning", {
        p_member_id: memberId,
        p_category: typeof body.category === "string" ? body.category : "manual",
        p_reason: typeof body.reason === "string" ? body.reason : "",
      });
      if (error) return rpcError(error, "warning_create_failed");
      return ownerAccessJsonResponse({ memberId, enforcement: data });
    }
    if (["sanction_create", "sanction_update", "sanction_cancel"].includes(action)) {
      const { data, error } = await access.userClient.rpc("manage_member_sanction", {
        p_action: action.replace("sanction_", ""), p_member_id: memberId,
        p_sanction_id: typeof body.sanctionId === "string" ? body.sanctionId : null,
        p_starts_at: typeof body.startsAt === "string" ? body.startsAt : null,
        p_ends_at: typeof body.endsAt === "string" ? body.endsAt : null,
        p_reason: typeof body.reason === "string" ? body.reason : null,
      });
      if (error) return rpcError(error, "sanction_update_failed");
      return ownerAccessJsonResponse({ memberId, sanction: data });
    }
    if (action === "delete") {
      const { data, error } = await access.userClient.rpc("prepare_managed_member_deletion", {
        p_member_id: memberId,
        p_reason: typeof body.reason === "string" ? body.reason : "관리자 삭제",
      });
      if (error) return rpcError(error, "member_delete_prepare_failed");
      const { error: deleteError } = await access.admin.auth.admin.deleteUser(memberId);
      if (deleteError) return ownerAccessJsonResponse({ error: "auth_delete_failed", message: "개인정보는 익명화했지만 인증 계정 삭제를 완료하지 못했습니다." }, 503);
      return ownerAccessJsonResponse({ member: data, deleted: true });
    }
    return ownerAccessJsonResponse({ error: "unsupported_action" }, 400);
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}
