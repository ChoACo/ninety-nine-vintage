import {
  authenticateOwnerAccessRequest,
  ownerAccessErrorResponse,
  ownerAccessJsonResponse,
  ownerRpc,
} from "@/src/lib/ownerAccess/server";
import {
  getTrustedClientIp,
  isUuid,
  readSecurityJsonBody,
  requiredBoundedString,
  SecurityRequestError,
} from "@/src/lib/securityAudit/server";

function nullableString(value: unknown, maxLength: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new SecurityRequestError(400, "invalid_request");
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new SecurityRequestError(400, "invalid_request");
  return normalized || null;
}

function nullableTimestamp(value: unknown): string | null {
  const normalized = nullableString(value, 64);
  if (normalized && !Number.isFinite(Date.parse(normalized))) {
    throw new SecurityRequestError(400, "invalid_request");
  }
  return normalized;
}

export async function POST(request: Request) {
  try {
    const context = await authenticateOwnerAccessRequest(request);
    const body = await readSecurityJsonBody(request);

    if (body.action === "list") {
      const items = await ownerRpc<unknown[]>(context, "owner_list_ip_block_rules", {
        p_reason: requiredBoundedString(body.reason, 10, 500),
        p_include_archived: body.includeArchived === true,
      });
      return ownerAccessJsonResponse({ items: items ?? [] });
    }

    if (body.action === "create") {
      const rows = await ownerRpc<string>(context, "owner_create_ip_block_rule", {
        p_network: requiredBoundedString(body.network, 2, 64),
        p_request_ip: getTrustedClientIp(request),
        p_reason: requiredBoundedString(body.reason, 10, 500),
        p_label: nullableString(body.label, 80),
        p_expires_at: nullableTimestamp(body.expiresAt),
      });
      return ownerAccessJsonResponse({ ruleId: rows }, 201);
    }

    return ownerAccessJsonResponse({ error: "invalid_request" }, 400);
  } catch (error) {
    if (error instanceof SecurityRequestError) {
      return ownerAccessJsonResponse({ error: error.code }, error.status);
    }
    return ownerAccessErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await authenticateOwnerAccessRequest(request);
    const body = await readSecurityJsonBody(request);
    if (!isUuid(body.ruleId)) {
      return ownerAccessJsonResponse({ error: "invalid_request" }, 400);
    }
    if (body.enabled != null && typeof body.enabled !== "boolean") {
      return ownerAccessJsonResponse({ error: "invalid_request" }, 400);
    }

    await ownerRpc(context, "owner_update_ip_block_rule", {
      p_rule_id: body.ruleId,
      p_change_reason: requiredBoundedString(body.changeReason, 10, 500),
      p_request_ip: getTrustedClientIp(request),
      p_network: nullableString(body.network, 64),
      p_label: nullableString(body.label, 80),
      p_clear_label: Object.hasOwn(body, "label") && body.label == null,
      p_reason: nullableString(body.reason, 500),
      p_enabled: typeof body.enabled === "boolean" ? body.enabled : null,
      p_expires_at: nullableTimestamp(body.expiresAt),
      p_clear_expires_at: Object.hasOwn(body, "expiresAt") && body.expiresAt == null,
      p_archive: body.archive === true,
    });
    return ownerAccessJsonResponse({ updated: true });
  } catch (error) {
    if (error instanceof SecurityRequestError) {
      return ownerAccessJsonResponse({ error: error.code }, error.status);
    }
    return ownerAccessErrorResponse(error);
  }
}
