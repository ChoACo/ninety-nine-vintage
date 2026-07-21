import { ACTIVE_COMMERCE_PAYMENT_MODE } from "@/lib/commerce/paymentMode";
import { getManualTransferAccount } from "@/lib/manualTransferConfig";
import {
  authenticateOwnerAccessRequest,
  ownerAccessErrorResponse,
  ownerAccessJsonResponse,
  readSmallJsonBody,
} from "@/lib/ownerAccess/server";

async function readRuntime(
  admin: Awaited<ReturnType<typeof authenticateOwnerAccessRequest>>["admin"],
) {
  try {
    const account = await getManualTransferAccount(admin);
    return {
      activeMode: ACTIVE_COMMERCE_PAYMENT_MODE,
      bankConfigured: true,
      portoneArchived: true,
      updatedAt: account.updatedAt,
    } as const;
  } catch {
    return {
      activeMode: ACTIVE_COMMERCE_PAYMENT_MODE,
      bankConfigured: false,
      portoneArchived: true,
      updatedAt: null,
    } as const;
  }
}

export async function GET(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    return ownerAccessJsonResponse(await readRuntime(access.admin));
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
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
    const runtime = await readRuntime(access.admin);
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
