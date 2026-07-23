import {
  authenticateOwnerAccessRequest,
  ownerAccessErrorResponse,
  ownerAccessJsonResponse,
  readSmallJsonBody,
} from "@/lib/ownerAccess/server";

function rpcError(
  error: { code?: string; message?: string } | null,
  fallback: string,
) {
  const status = error?.code === "42501"
    ? 403
    : error?.code === "P0002"
      ? 404
      : ["55000", "PT409"].includes(error?.code ?? "")
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
    const limit = Math.min(
      500,
      Math.max(1, Number(url.searchParams.get("limit") || 200)),
    );
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
    const { data, error } = await access.userClient.rpc(
      "get_owner_withdrawn_member_retention",
      { p_limit: limit, p_offset: offset },
    );
    if (error) return rpcError(error, "withdrawn_member_directory_unavailable");
    return ownerAccessJsonResponse({
      members: Array.isArray(data) ? data : [],
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
    if (!memberId || body.action !== "retry_cleanup") {
      return ownerAccessJsonResponse({ error: "invalid_cleanup_request" }, 400);
    }

    const { data: authAccount, error: authLookupError } =
      await access.admin.auth.admin.getUserById(memberId);
    if (
      authLookupError &&
      !authLookupError.message.toLowerCase().includes("not found")
    ) {
      return ownerAccessJsonResponse(
        {
          error: "auth_lookup_failed",
          message: "인증 계정 상태를 확인하지 못했습니다.",
        },
        503,
      );
    }
    if (authAccount?.user) {
      const { error: authDeleteError } =
        await access.admin.auth.admin.deleteUser(memberId);
      if (authDeleteError) {
        return ownerAccessJsonResponse(
          {
            error: "auth_delete_failed",
            message: "인증 계정을 삭제하지 못했습니다.",
          },
          503,
        );
      }
    }

    const { data, error } = await access.userClient.rpc(
      "retry_withdrawn_member_cleanup",
      { p_member_id: memberId },
    );
    if (error) return rpcError(error, "withdrawn_member_cleanup_failed");
    return ownerAccessJsonResponse({ member: data, cleaned: true });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}
