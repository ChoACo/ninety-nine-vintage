import {
  authenticateOwnerAccessRequest,
  ownerAccessErrorResponse,
  ownerAccessJsonResponse,
  ownerRpc,
  readSmallJsonBody,
} from "@/src/lib/ownerAccess/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const context = await authenticateOwnerAccessRequest(request);
    const [targets, current, audit] = await Promise.all([
      ownerRpc<unknown[]>(context, "list_owner_operator_delegation_targets"),
      ownerRpc<unknown[]>(context, "get_current_owner_operator_delegation"),
      ownerRpc<unknown[]>(context, "get_owner_operator_delegation_audit", {
        p_limit: 100,
        p_offset: 0,
      }),
    ]);
    return ownerAccessJsonResponse({
      targets: targets ?? [],
      current: current?.[0] ?? null,
      audit: audit ?? [],
    });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await authenticateOwnerAccessRequest(request);
    const body = await readSmallJsonBody(request);
    const operatorId = typeof body.operatorId === "string" ? body.operatorId : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!UUID_PATTERN.test(operatorId) || reason.length < 3 || reason.length > 300) {
      return ownerAccessJsonResponse({ error: "invalid_request" }, 400);
    }
    const rows = await ownerRpc<unknown[]>(context, "begin_owner_operator_delegation", {
      p_target_operator_id: operatorId,
      p_reason: reason,
    });
    return ownerAccessJsonResponse({ session: rows?.[0] ?? null }, 201);
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await authenticateOwnerAccessRequest(request);
    const body = await readSmallJsonBody(request);
    const sessionId =
      typeof body.sessionId === "string" && body.sessionId
        ? body.sessionId
        : null;
    if (sessionId && !UUID_PATTERN.test(sessionId)) {
      return ownerAccessJsonResponse({ error: "invalid_request" }, 400);
    }
    const ended = await ownerRpc<boolean>(context, "end_owner_operator_delegation", {
      p_session_id: sessionId,
    });
    return ownerAccessJsonResponse({ ended: Boolean(ended) });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}
