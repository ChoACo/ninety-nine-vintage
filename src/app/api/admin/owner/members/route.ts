import { authenticateOwnerAccessRequest, ownerAccessErrorResponse, ownerAccessJsonResponse, readSmallJsonBody } from "@/lib/ownerAccess/server";
import {
  isManagedMemberStatus,
  normalizeManagementReason,
} from "@/lib/memberManagement/contracts";

function rpcError(
  error: { code?: string; message?: string } | null,
  fallback: string,
) {
  const status = error?.code === "42501"
    ? 403
    : error?.code === "P0002"
      ? 404
      : ["PT409", "23503", "23505", "55000"].includes(error?.code ?? "")
        ? 409
        : ["22023", "23514"].includes(error?.code ?? "")
          ? 422
          : 503;
  return ownerAccessJsonResponse(
    { error: fallback, message: error?.message ?? fallback },
    status,
  );
}

export async function GET(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const url = new URL(request.url);
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 200)));
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
    const { data, error } = await access.userClient.rpc("get_manager_member_directory", { p_limit: limit, p_offset: offset });
    if (error) return rpcError(error, "member_directory_unavailable");
    const rows = Array.isArray(data) ? data as Record<string, unknown>[] : [];
    const memberIds = rows.flatMap((row) =>
      typeof row.id === "string" ? [row.id] : []
    );
    const { data: roleRows, error: roleError } = memberIds.length === 0
      ? { data: [], error: null }
      : await access.admin
        .from("account_access_roles")
        .select("user_id,reports_to_operator_id")
        .in("user_id", memberIds);
    if (roleError) return rpcError(roleError, "member_directory_unavailable");
    const managers = new Map(
      (roleRows ?? []).map((row) => [row.user_id, row.reports_to_operator_id]),
    );
    return ownerAccessJsonResponse({
      members: rows.map((row) => ({
        ...row,
        reports_to_operator_id:
          typeof row.id === "string" ? managers.get(row.id) ?? null : null,
      })),
      limit,
      offset,
    });
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
      const reportsToOperatorId =
        typeof body.reportsToOperatorId === "string"
          ? body.reportsToOperatorId
          : null;
      if (roleCode === "employee" && !reportsToOperatorId) {
        return ownerAccessJsonResponse({ error: "operator_required" }, 400);
      }
      const { data, error } = await access.userClient.rpc("set_managed_staff_role", {
        p_member_id: memberId,
        p_role_code: roleCode,
        p_reports_to_operator_id: reportsToOperatorId,
      });
      if (error) return rpcError(error, "role_update_failed");
      return ownerAccessJsonResponse({ member: data });
    }
    if (action === "status") {
      const status = body.status;
      const reason = normalizeManagementReason(body.reason);
      if (!isManagedMemberStatus(status) || !reason) {
        return ownerAccessJsonResponse(
          { error: "invalid_status_request", message: "상태와 처리 사유를 확인해 주세요." },
          400,
        );
      }
      const { data, error } = await access.userClient.rpc("set_managed_member_status", {
        p_member_id: memberId,
        p_status: status,
        p_suspended_until: typeof body.suspendedUntil === "string" ? body.suspendedUntil : null,
        p_reason: reason,
      });
      if (error) return rpcError(error, "status_update_failed");
      return ownerAccessJsonResponse({ member: data });
    }
    if (action === "profile") {
      const phone = typeof body.phone === "string" ? body.phone.trim() : "";
      const { error } = await access.userClient.rpc("update_managed_member", {
        p_member_id: memberId,
        p_display_name: "",
        p_phone: phone,
      });
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
      const reason = normalizeManagementReason(body.reason);
      if (!reason) {
        return ownerAccessJsonResponse(
          { error: "invalid_warning_reason", message: "경고 사유를 입력해 주세요." },
          400,
        );
      }
      const { data, error } = await access.userClient.rpc("add_member_warning", {
        p_member_id: memberId,
        p_category: typeof body.category === "string" ? body.category : "manual",
        p_reason: reason,
      });
      if (error) return rpcError(error, "warning_create_failed");
      return ownerAccessJsonResponse({ memberId, enforcement: data });
    }
    if (action === "enforcement_clear") {
      const scope = typeof body.scope === "string" ? body.scope : "";
      const reason = normalizeManagementReason(body.reason);
      if (!["warnings", "sanctions", "all"].includes(scope) || !reason) {
        return ownerAccessJsonResponse(
          {
            error: "invalid_enforcement_request",
            message: "초기화 범위와 처리 사유를 확인해 주세요.",
          },
          400,
        );
      }
      const { data, error } = await access.userClient.rpc(
        "clear_member_enforcement_history",
        {
          p_member_id: memberId,
          p_scope: scope,
          p_reason: reason,
        },
      );
      if (error) return rpcError(error, "enforcement_clear_failed");
      return ownerAccessJsonResponse({ memberId, enforcement: data });
    }
    if (["sanction_create", "sanction_update", "sanction_cancel"].includes(action)) {
      const reason = normalizeManagementReason(body.reason);
      if (!reason) {
        return ownerAccessJsonResponse(
          { error: "invalid_sanction_reason", message: "제재 처리 사유를 입력해 주세요." },
          400,
        );
      }
      const { data, error } = action === "sanction_create"
        ? await access.userClient.rpc("create_member_24_hour_sanction", {
            p_member_id: memberId,
            p_reason: reason,
          })
        : await access.userClient.rpc("manage_member_sanction", {
            p_action: action.replace("sanction_", ""),
            p_member_id: memberId,
            p_sanction_id: typeof body.sanctionId === "string" ? body.sanctionId : null,
            p_starts_at: typeof body.startsAt === "string" ? body.startsAt : null,
            p_ends_at: typeof body.endsAt === "string" ? body.endsAt : null,
            p_reason: reason,
          });
      if (error) return rpcError(error, "sanction_update_failed");
      return ownerAccessJsonResponse({ memberId, sanction: data });
    }
    if (action === "delete") {
      const reason = normalizeManagementReason(body.reason);
      if (!reason) {
        return ownerAccessJsonResponse(
          { error: "invalid_deletion_reason", message: "탈퇴 처리 사유를 입력해 주세요." },
          400,
        );
      }
      const { data, error } = await access.userClient.rpc("prepare_managed_member_deletion", {
        p_member_id: memberId,
        p_reason: reason,
      });
      if (error) return rpcError(error, "member_delete_prepare_failed");
      const { error: deleteError } = await access.admin.auth.admin.deleteUser(memberId);
      if (deleteError) return ownerAccessJsonResponse({ error: "auth_delete_failed", message: "개인정보는 익명화했지만 인증 계정 삭제를 완료하지 못했습니다." }, 503);
      return ownerAccessJsonResponse({ member: data, deleted: true });
    }
    if (action === "purge") {
      const reason = normalizeManagementReason(body.reason);
      if (!reason) {
        return ownerAccessJsonResponse(
          { error: "invalid_cleanup_reason", message: "정리 재시도 사유를 입력해 주세요." },
          400,
        );
      }
      const { data, error } = await access.userClient.rpc(
        "purge_deleted_member_record",
        {
          p_member_id: memberId,
          p_reason: reason,
        },
      );
      if (error) return rpcError(error, "member_purge_failed");
      return ownerAccessJsonResponse({ member: data, purged: true });
    }
    return ownerAccessJsonResponse({ error: "unsupported_action" }, 400);
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}
