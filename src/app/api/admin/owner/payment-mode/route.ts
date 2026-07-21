import {
  authenticateOwnerAccessRequest,
  ownerAccessErrorResponse,
  ownerAccessJsonResponse,
  readSmallJsonBody,
} from "@/src/lib/ownerAccess/server";
import { ACTIVE_COMMERCE_PAYMENT_MODE } from "@/lib/commerce/paymentMode";
import { getManualTransferAccount } from "@/lib/manualTransferConfig";

function readRuntime() {
  let bankConfigured = true;
  try {
    getManualTransferAccount();
  } catch {
    bankConfigured = false;
  }
  return {
    activeMode: ACTIVE_COMMERCE_PAYMENT_MODE,
    bankConfigured,
    portoneArchived: true,
    updatedAt: null,
  };
}

export async function GET(request: Request) {
  try {
    await authenticateOwnerAccessRequest(request);
    return ownerAccessJsonResponse(readRuntime());
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await authenticateOwnerAccessRequest(request);
    const body = await readSmallJsonBody(request);
    const mode = body.mode;
    if (mode === "portone") {
      return ownerAccessJsonResponse(
        { error: "portone_archived", activeMode: ACTIVE_COMMERCE_PAYMENT_MODE },
        409,
      );
    }
    if (mode !== ACTIVE_COMMERCE_PAYMENT_MODE) {
      return ownerAccessJsonResponse({ error: "invalid_payment_mode" }, 400);
    }
    const runtime = readRuntime();
    if (!runtime.bankConfigured) {
      return ownerAccessJsonResponse(
        { error: "manual_transfer_not_ready" },
        409,
      );
    }
    return ownerAccessJsonResponse(runtime);
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}
