import {
  authenticateSecurityRequest,
  getTrustedClientIp,
  isUuid,
  readSecurityJsonBody,
  securityErrorResponse,
  securityJsonResponse,
  serviceSecurityRpc,
} from "@/src/lib/securityAudit/server";

interface SessionRecordRow {
  allowed: boolean;
  session_record_id: string;
  recorded: boolean;
  matched_rule_id: string | null;
}

const EVENTS = new Set(["session_started", "session_resumed", "heartbeat"]);

export async function POST(request: Request) {
  try {
    const context = await authenticateSecurityRequest(request);
    const body = await readSecurityJsonBody(request, 4096);
    const clientSessionId = body.clientSessionId;
    const event = body.event;
    if (!isUuid(clientSessionId) || typeof event !== "string" || !EVENTS.has(event)) {
      return securityJsonResponse({ error: "invalid_request" }, 400);
    }

    const ipAddress = getTrustedClientIp(request);
    const userAgent = request.headers.get("user-agent")?.slice(0, 512) ?? null;
    const rows = await serviceSecurityRpc<SessionRecordRow[]>(
      context.admin,
      "record_security_session_event",
      {
        p_user_id: context.user.id,
        p_auth_session_id: context.authSessionId,
        p_client_session_id: clientSessionId,
        p_ip: ipAddress,
        p_user_agent: userAgent,
        p_event_type: event,
      },
    );
    const result = rows?.[0];
    if (!result) return securityJsonResponse({ error: "security_record_failed" }, 500);
    if (!result.allowed) {
      // The matched rule is intentionally not disclosed to the blocked client.
      return securityJsonResponse({ allowed: false, error: "ip_blocked" }, 403);
    }

    return securityJsonResponse({
      allowed: true,
      sessionRecordId: result.session_record_id,
      recorded: Boolean(result.recorded),
    });
  } catch (error) {
    return securityErrorResponse(error);
  }
}
