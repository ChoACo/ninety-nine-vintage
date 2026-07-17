import {
  authenticateOwnerRequest,
  createOwnerModeSession,
  ownerModeErrorResponse,
  ownerModeJsonResponse,
  processOwnerPinAttempt,
  serializeOwnerModeCookie,
  verifyOwnerModePin,
} from "@/src/lib/ownerMode/server";

interface UnlockRequestBody {
  pin?: unknown;
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 1_024) {
      return ownerModeJsonResponse({ error: "invalid_request" }, 400);
    }

    const context = await authenticateOwnerRequest(request);
    const body = (await request.json().catch(() => null)) as UnlockRequestBody | null;
    const pin = typeof body?.pin === "string" ? body.pin.trim() : "";
    const matches = /^\d{4}$/.test(pin) && (await verifyOwnerModePin(pin));
    const attempt = await processOwnerPinAttempt(context, matches);
    if (!attempt.allowed) {
      const isLocked = Boolean(attempt.locked_until);
      return ownerModeJsonResponse(
        { error: isLocked ? "temporarily_locked" : "invalid_pin" },
        isLocked ? 429 : 403,
      );
    }

    const session = await createOwnerModeSession(context);
    return ownerModeJsonResponse(
      { unlocked: true, expiresAt: session.expiresAt },
      200,
      serializeOwnerModeCookie(session.token),
    );
  } catch (error) {
    return ownerModeErrorResponse(error);
  }
}

export async function GET() {
  return ownerModeJsonResponse({ error: "method_not_allowed" }, 405);
}
