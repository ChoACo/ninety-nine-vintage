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

const CATEGORY_PATTERN = /^[a-z][a-z0-9_.:-]{1,63}$/;

function timestamp(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new SecurityRequestError(400, "invalid_request");
  }
  return value;
}

export async function POST(request: Request) {
  try {
    const context = await authenticateOwnerAccessRequest(request);
    const body = await readSecurityJsonBody(request);
    if (body.action !== "list") {
      return ownerAccessJsonResponse({ error: "invalid_request" }, 400);
    }
    const reason = requiredBoundedString(body.reason, 10, 500);
    const userId = body.userId == null || body.userId === "" ? null : body.userId;
    if (userId !== null && !isUuid(userId)) {
      return ownerAccessJsonResponse({ error: "invalid_request" }, 400);
    }
    const category = optionalBoundedString(body.category, 64);
    if (category && !CATEGORY_PATTERN.test(category)) {
      return ownerAccessJsonResponse({ error: "invalid_request" }, 400);
    }

    const items = await ownerRpc<unknown[]>(context, "owner_list_security_activity", {
      p_reason: reason,
      p_user_id: userId,
      p_category: category,
      p_from: timestamp(body.from),
      p_to: timestamp(body.to),
      p_limit: boundedInteger(body.limit, 100, 1, 200),
      p_offset: boundedInteger(body.offset, 0, 0, 100000),
    });
    return ownerAccessJsonResponse({ items: items ?? [] });
  } catch (error) {
    if (error instanceof SecurityRequestError) {
      return ownerAccessJsonResponse({ error: error.code }, error.status);
    }
    return ownerAccessErrorResponse(error);
  }
}
