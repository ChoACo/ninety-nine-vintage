import {
  authenticateOwnerRequest,
  clearOwnerModeCookie,
  ownerModeErrorResponse,
  ownerModeJsonResponse,
  validateOwnerModeSession,
} from "@/src/lib/ownerMode/server";

export async function POST(request: Request) {
  try {
    const context = await authenticateOwnerRequest(request);
    const status = await validateOwnerModeSession(request, context);
    return ownerModeJsonResponse(
      { unlocked: status.unlocked, expiresAt: status.expiresAt },
      200,
      status.unlocked ? undefined : clearOwnerModeCookie(),
    );
  } catch (error) {
    return ownerModeErrorResponse(error);
  }
}

export async function GET() {
  return ownerModeJsonResponse({ error: "method_not_allowed" }, 405);
}
