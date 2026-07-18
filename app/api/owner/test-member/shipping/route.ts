import {
  authenticateOwnerAccessRequest,
  ownerAccessErrorResponse,
  ownerAccessJsonResponse,
  ownerRpc,
  readSmallJsonBody,
} from "@/src/lib/ownerAccess/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const context = await authenticateOwnerAccessRequest(request);
    const body = await readSmallJsonBody(request);
    const productIds = Array.isArray(body.productIds)
      ? body.productIds.filter((value): value is string => typeof value === "string")
      : [];
    const addressId = typeof body.addressId === "string" ? body.addressId : "";
    if (
      productIds.length < 1 ||
      productIds.length > 100 ||
      productIds.some((id) => !UUID_PATTERN.test(id)) ||
      new Set(productIds).size !== productIds.length ||
      !UUID_PATTERN.test(addressId)
    ) {
      return ownerAccessJsonResponse({ error: "invalid_request" }, 400);
    }
    const requestId = await ownerRpc<string>(
      context,
      "owner_request_hidden_test_shipping",
      { p_product_ids: productIds, p_address_id: addressId },
    );
    return ownerAccessJsonResponse({ requestId }, 201);
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await authenticateOwnerAccessRequest(request);
    const body = await readSmallJsonBody(request);
    const requestId = typeof body.requestId === "string" ? body.requestId : "";
    const courier = typeof body.courier === "string" ? body.courier.trim() : "";
    const trackingNumber =
      typeof body.trackingNumber === "string" ? body.trackingNumber.trim() : "";
    if (
      !UUID_PATTERN.test(requestId) ||
      courier.length < 1 || courier.length > 80 ||
      trackingNumber.length < 1 || trackingNumber.length > 120
    ) {
      return ownerAccessJsonResponse({ error: "invalid_request" }, 400);
    }
    const status = await ownerRpc<string>(
      context,
      "owner_mark_hidden_test_shipping_shipped",
      {
        p_request_id: requestId,
        p_courier: courier,
        p_tracking_number: trackingNumber,
      },
    );
    return ownerAccessJsonResponse({ status });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}
