import {
  authenticateOwnerRequest,
  clearOwnerModeCookie,
  ownerModeErrorResponse,
  ownerModeJsonResponse,
  revokeOwnerModeSession,
} from "@/src/lib/ownerMode/server";

export async function POST(request: Request) {
  try {
    const context = await authenticateOwnerRequest(request);
    await revokeOwnerModeSession(request, context);
    return ownerModeJsonResponse(
      { unlocked: false, expiresAt: null },
      200,
      clearOwnerModeCookie(),
    );
  } catch (error) {
    const response = ownerModeErrorResponse(error);
    response.headers.append("Set-Cookie", clearOwnerModeCookie());
    return response;
  }
}

export async function GET() {
  return ownerModeJsonResponse({ error: "method_not_allowed" }, 405);
}
