import {
  authenticateOwnerAccessRequest,
  ownerAccessErrorResponse,
  ownerAccessJsonResponse,
  ownerRpc,
} from "@/src/lib/ownerAccess/server";
import {
  boundedInteger,
  isUuid,
  readSecurityJsonBody,
  requiredBoundedString,
  SecurityRequestError,
} from "@/src/lib/securityAudit/server";

const STATUSES = new Set([
  "awaiting_subject_consent",
  "awaiting_owner_approval",
  "approved",
  "denied",
  "revoked",
  "expired",
]);

export async function POST(request: Request) {
  try {
    const context = await authenticateOwnerAccessRequest(request);
    const body = await readSecurityJsonBody(request);
    const action = body.action;

    if (action === "list") {
      const reason = requiredBoundedString(body.reason, 10, 500);
      const status = body.status == null || body.status === "" ? null : body.status;
      const userId = body.userId == null || body.userId === "" ? null : body.userId;
      if (
        (status !== null && (typeof status !== "string" || !STATUSES.has(status))) ||
        (userId !== null && !isUuid(userId))
      ) {
        return ownerAccessJsonResponse({ error: "invalid_request" }, 400);
      }
      const items = await ownerRpc<unknown[]>(
        context,
        "owner_list_security_log_access_requests",
        {
          p_reason: reason,
          p_status: status,
          p_user_id: userId,
          p_limit: boundedInteger(body.limit, 100, 1, 200),
          p_offset: boundedInteger(body.offset, 0, 0, 100000),
        },
      );
      return ownerAccessJsonResponse({ items: items ?? [] });
    }

    if (action === "revoke") {
      if (!isUuid(body.requestId)) {
        return ownerAccessJsonResponse({ error: "invalid_request" }, 400);
      }
      await ownerRpc(context, "revoke_security_log_access", {
        p_request_id: body.requestId,
        p_reason: requiredBoundedString(body.reason, 10, 500),
      });
      return ownerAccessJsonResponse({ revoked: true });
    }

    // Backwards-compatible decision body: action may be omitted by an older UI.
    if (action == null || action === "decide") {
      if (!isUuid(body.requestId) || typeof body.approved !== "boolean") {
        return ownerAccessJsonResponse({ error: "invalid_request" }, 400);
      }
      await ownerRpc(context, "owner_decide_security_log_access", {
        p_request_id: body.requestId,
        p_approved: body.approved,
        p_note: requiredBoundedString(body.note, 10, 500),
        p_access_hours: boundedInteger(body.accessHours, 24, 1, 24),
      });
      return ownerAccessJsonResponse({ decided: true });
    }

    return ownerAccessJsonResponse({ error: "invalid_request" }, 400);
  } catch (error) {
    if (error instanceof SecurityRequestError) {
      return ownerAccessJsonResponse({ error: error.code }, error.status);
    }
    return ownerAccessErrorResponse(error);
  }
}
