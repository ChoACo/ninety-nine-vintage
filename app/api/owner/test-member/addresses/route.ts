import {
  authenticateOwnerAccessRequest,
  ownerAccessErrorResponse,
  ownerAccessJsonResponse,
  ownerRpc,
  readSmallJsonBody,
} from "@/src/lib/ownerAccess/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PUT(request: Request) {
  try {
    const context = await authenticateOwnerAccessRequest(request);
    const body = await readSmallJsonBody(request);
    const id = typeof body.id === "string" && body.id ? body.id : null;
    const label = typeof body.label === "string" ? body.label.trim() : "";
    const recipientName =
      typeof body.recipientName === "string" ? body.recipientName.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const isDefault = body.isDefault === true;
    if (
      (id && !UUID_PATTERN.test(id)) ||
      !label || label.length > 40 ||
      !recipientName || recipientName.length > 80 ||
      phone.length < 7 || phone.length > 30 ||
      address.length < 5 || address.length > 500
    ) {
      return ownerAccessJsonResponse({ error: "invalid_request" }, 400);
    }
    const rows = await ownerRpc<unknown[]>(
      context,
      "owner_upsert_hidden_test_shipping_address",
      {
        p_id: id,
        p_label: label,
        p_recipient_name: recipientName,
        p_phone: phone,
        p_address: address,
        p_is_default: isDefault,
      },
    );
    return ownerAccessJsonResponse({ address: rows?.[0] ?? null });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await authenticateOwnerAccessRequest(request);
    const body = await readSmallJsonBody(request);
    const addressId = typeof body.addressId === "string" ? body.addressId : "";
    if (!UUID_PATTERN.test(addressId)) {
      return ownerAccessJsonResponse({ error: "invalid_request" }, 400);
    }
    const deleted = await ownerRpc<boolean>(
      context,
      "owner_delete_hidden_test_shipping_address",
      { p_address_id: addressId },
    );
    return ownerAccessJsonResponse({ deleted: Boolean(deleted) });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}
