import {
  authenticateOwnerAccessRequest,
  ownerAccessErrorResponse,
  ownerAccessJsonResponse,
} from "@/lib/ownerAccess/server";
import { syncManualTransferSettings } from "@/lib/manualTransferConfig";

export async function GET(request: Request) {
  try {
    const context = await authenticateOwnerAccessRequest(request);
    await syncManualTransferSettings(context.admin);
    return ownerAccessJsonResponse({
      activeMode: "manual_transfer",
      bankConfigured: true,
      configurationSource: "server_environment",
      portoneReady: false,
      portoneLocked: true,
    });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}

/** Payment mode and bank details are deployment configuration, not UI input. */
export async function PATCH(request: Request) {
  try {
    await authenticateOwnerAccessRequest(request);
    return ownerAccessJsonResponse({ error: "payment_configuration_managed_by_environment" }, 405);
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}
