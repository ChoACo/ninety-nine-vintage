import {
  authenticatePaymentRequest,
  getAuthorizedPaymentBuyerIds,
  paymentJsonResponse,
} from "@/src/lib/portone/http";
import {
  isValidPaymentId,
  logPortOneServerError,
  PortOneIntegrationError,
  verifyAndSyncPortOnePayment,
} from "@/src/lib/portone/server";

export async function POST(request: Request) {
  try {
    const authentication = await authenticatePaymentRequest(request);
    if (!authentication.ok) return authentication.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return paymentJsonResponse({ error: "invalid_json" }, 400);
    }
    const paymentId =
      body && typeof body === "object"
        ? (body as Record<string, unknown>).paymentId
        : null;
    if (!isValidPaymentId(paymentId)) {
      return paymentJsonResponse({ error: "invalid_payment_id" }, 400);
    }

    const allowedBuyerIds = await getAuthorizedPaymentBuyerIds(
      authentication.admin,
      authentication.userId,
    );
    const synced = await verifyAndSyncPortOnePayment(
      authentication.admin,
      paymentId,
      { allowedBuyerIds },
    );
    return paymentJsonResponse(
      {
        paymentStatus: synced.payment_status,
        portoneStatus: synced.portone_status,
      },
      200,
    );
  } catch (error) {
    logPortOneServerError("browser_sync", error);
    if (error instanceof PortOneIntegrationError) {
      return paymentJsonResponse({ error: error.code }, error.status);
    }
    return paymentJsonResponse({ error: "payment_sync_failed" }, 500);
  }
}

export async function GET() {
  return paymentJsonResponse({ error: "method_not_allowed" }, 405);
}
