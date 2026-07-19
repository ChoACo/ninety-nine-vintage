import {
  authenticateOwnerAccessRequest,
  ownerAccessErrorResponse,
  ownerAccessJsonResponse,
  ownerRpc,
} from "@/src/lib/ownerAccess/server";
import {
  boundedInteger,
  isUuid,
  optionalBoundedString,
  readSecurityJsonBody,
  requiredBoundedString,
  SecurityRequestError,
} from "@/src/lib/securityAudit/server";

export async function POST(request: Request) {
  try {
    const context = await authenticateOwnerAccessRequest(request);
    const body = await readSecurityJsonBody(request);
    const reason = requiredBoundedString(body.reason, 10, 500);
    const limit = boundedInteger(body.limit, 100, 1, 200);
    const offset = boundedInteger(body.offset, 0, 0, 100000);

    if (body.action === "history") {
      if (!isUuid(body.sessionRecordId)) {
        return ownerAccessJsonResponse({ error: "invalid_request" }, 400);
      }
      const items = await ownerRpc<unknown[]>(
        context,
        "owner_list_security_session_history",
        {
          p_session_record_id: body.sessionRecordId,
          p_reason: reason,
          p_limit: limit,
          p_offset: offset,
        },
      );
      return ownerAccessJsonResponse({ items: items ?? [] });
    }

    if (body.action === "list") {
      const userId = body.userId == null || body.userId === "" ? null : body.userId;
      if (userId !== null && !isUuid(userId)) {
        return ownerAccessJsonResponse({ error: "invalid_request" }, 400);
      }
      const outcome = optionalBoundedString(body.outcome, 16);
      if (outcome && outcome !== "allowed" && outcome !== "blocked") {
        return ownerAccessJsonResponse({ error: "invalid_request" }, 400);
      }
      const items = await ownerRpc<unknown[]>(context, "owner_list_security_sessions", {
        p_reason: reason,
        p_user_id: userId,
        p_ip: optionalBoundedString(body.ip, 64),
        p_outcome: outcome,
        p_limit: limit,
        p_offset: offset,
      });
      return ownerAccessJsonResponse({ items: items ?? [] });
    }

    return ownerAccessJsonResponse({ error: "invalid_request" }, 400);
  } catch (error) {
    if (error instanceof SecurityRequestError) {
      return ownerAccessJsonResponse({ error: error.code }, error.status);
    }
    return ownerAccessErrorResponse(error);
  }
}
