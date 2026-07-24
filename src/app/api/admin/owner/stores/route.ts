import {
  authenticateOwnerAccessRequest,
  ownerAccessErrorResponse,
  ownerAccessJsonResponse,
  readSmallJsonBody,
} from "@/lib/ownerAccess/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9-]{2,80}$/;

function readUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

function readVersion(value: unknown): number | null {
  const version = Number(value);
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
}

function rpcError(
  error: { code?: string; message?: string } | null,
  fallback: string,
) {
  const status =
    error?.code === "42501"
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
    const { data, error } = await access.userClient.rpc(
      "get_owner_store_management",
    );
    if (error) return rpcError(error, "store_management_unavailable");
    return ownerAccessJsonResponse({
      management:
        data && typeof data === "object"
          ? (data as Record<string, unknown>)
          : {},
    });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const body = await readSmallJsonBody(request);
    const action = typeof body.action === "string" ? body.action : "";
    const idempotencyKey = readUuid(body.idempotencyKey);
    if (!idempotencyKey) {
      return ownerAccessJsonResponse(
        {
          error: "invalid_idempotency_key",
          message: "중복 처리 방지 키를 확인해 주세요.",
        },
        400,
      );
    }

    if (
      action === "create" ||
      action === "update" ||
      action === "archive" ||
      action === "restore"
    ) {
      const storeId = action === "create" ? null : readUuid(body.storeId);
      const businessId =
        action === "create" ? readUuid(body.businessId) : null;
      const operatorId =
        action === "archive" || action === "restore"
          ? null
          : readUuid(body.operatorId);
      const expectedVersion =
        action === "create" ? null : readVersion(body.expectedVersion);
      const slug =
        typeof body.slug === "string" ? body.slug.trim().toLowerCase() : null;
      const name = typeof body.name === "string" ? body.name.trim() : null;
      const description =
        typeof body.description === "string" ? body.description.trim() : "";

      if (
        (action === "create" && (!businessId || !operatorId)) ||
        (action !== "create" && (!storeId || expectedVersion === null)) ||
        ((action === "create" || action === "update") &&
          (!operatorId ||
            !slug ||
            !SLUG_PATTERN.test(slug) ||
            !name ||
            name.length > 80 ||
            description.length > 1000))
      ) {
        return ownerAccessJsonResponse(
          {
            error: "invalid_store_request",
            message: "센터(매장) 정보를 확인해 주세요.",
          },
          400,
        );
      }

      const { data, error } = await access.userClient.rpc(
        "manage_owner_store",
        {
          p_action: action,
          p_store_id: storeId,
          p_business_id: businessId,
          p_slug: slug,
          p_name: name,
          p_description: description,
          p_operator_id: operatorId,
          p_expected_version: expectedVersion,
          p_idempotency_key: idempotencyKey,
          p_reason:
            action === "create"
              ? "관리자 센터에서 센터(매장) 추가"
              : action === "update"
                ? "관리자 센터에서 센터(매장) 정보 및 운영자 수정"
                : action === "archive"
                  ? "관리자 센터에서 센터(매장) 삭제"
                  : "관리자 센터에서 센터(매장) 복구",
        },
      );
      if (error) return rpcError(error, "store_management_failed");
      return ownerAccessJsonResponse({ result: data });
    }

    if (action === "employee_assign" || action === "employee_remove") {
      const storeId = readUuid(body.storeId);
      const employeeId = readUuid(body.employeeId);
      const expectedStoreVersion = readVersion(body.expectedStoreVersion);
      const expectedMembershipVersion =
        body.expectedMembershipVersion === null ||
        body.expectedMembershipVersion === undefined
          ? null
          : readVersion(body.expectedMembershipVersion);
      if (
        !storeId ||
        !employeeId ||
        expectedStoreVersion === null ||
        (body.expectedMembershipVersion !== null &&
          body.expectedMembershipVersion !== undefined &&
          expectedMembershipVersion === null)
      ) {
        return ownerAccessJsonResponse(
          {
            error: "invalid_employee_placement",
            message: "직원 배치 정보를 확인해 주세요.",
          },
          400,
        );
      }

      const { data, error } = await access.userClient.rpc(
        "set_owner_store_employee",
        {
          p_store_id: storeId,
          p_employee_id: employeeId,
          p_active: action === "employee_assign",
          p_expected_store_version: expectedStoreVersion,
          p_expected_membership_version: expectedMembershipVersion,
          p_idempotency_key: idempotencyKey,
          p_reason:
            action === "employee_assign"
              ? "관리자 센터에서 매장 직원 배치"
              : "관리자 센터에서 매장 직원 배치 해제",
        },
      );
      if (error) return rpcError(error, "employee_placement_failed");
      return ownerAccessJsonResponse({ result: data });
    }

    return ownerAccessJsonResponse(
      { error: "unsupported_action", message: "지원하지 않는 작업입니다." },
      400,
    );
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}
