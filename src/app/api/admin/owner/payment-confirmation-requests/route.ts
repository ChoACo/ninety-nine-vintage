import {
  authenticateOwnerAccessRequest,
  ownerAccessErrorResponse,
  ownerAccessJsonResponse,
} from "@/lib/ownerAccess/server";

export async function GET(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const { data, error } = await access.userClient.rpc(
      "get_owner_payment_confirmation_queue",
    );
    if (error) {
      return ownerAccessJsonResponse(
        { error: "payment_confirmation_queue_unavailable" },
        503,
      );
    }
    return ownerAccessJsonResponse({ requests: data ?? [] });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}
