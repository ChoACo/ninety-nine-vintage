import {
  authenticateOwnerAccessRequest,
  ownerAccessErrorResponse,
  ownerAccessJsonResponse,
  ownerRpc,
  readSmallJsonBody,
} from "@/src/lib/ownerAccess/server";

export async function GET(request: Request) {
  try {
    const context = await authenticateOwnerAccessRequest(request);
    const member = await ownerRpc<unknown[]>(context, "get_owner_hidden_test_member");
    if (!member?.[0]) {
      const audit = await ownerRpc<unknown[]>(
        context,
        "get_owner_hidden_test_member_audit",
        { p_limit: 100, p_offset: 0 },
      );
      return ownerAccessJsonResponse({
        member: null,
        wonProducts: [],
        shippingRequests: [],
        audit: audit ?? [],
      });
    }
    const [wonProducts, shippingRequests, audit] = await Promise.all([
      ownerRpc<unknown[]>(context, "get_owner_hidden_test_won_products"),
      ownerRpc<unknown[]>(context, "get_owner_hidden_test_shipping_requests"),
      ownerRpc<unknown[]>(context, "get_owner_hidden_test_member_audit", {
        p_limit: 100,
        p_offset: 0,
      }),
    ]);
    return ownerAccessJsonResponse({
      member: member?.[0] ?? null,
      wonProducts: wonProducts ?? [],
      shippingRequests: shippingRequests ?? [],
      audit: audit ?? [],
    });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await authenticateOwnerAccessRequest(request);
    const body = await readSmallJsonBody(request);
    if (Number.isInteger(body.shippingCreditCount)) {
      const shippingCreditCount = Number(body.shippingCreditCount);
      if (shippingCreditCount < 0 || shippingCreditCount > 10_000) {
        return ownerAccessJsonResponse({ error: "invalid_request" }, 400);
      }
      const result = await ownerRpc<number>(
        context,
        "owner_set_hidden_test_shipping_credits",
        { p_credit_count: shippingCreditCount },
      );
      return ownerAccessJsonResponse({ updated: true, shippingCreditCount: result });
    }
    const displayName =
      typeof body.displayName === "string" ? body.displayName.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : null;
    if (
      displayName.length < 2 ||
      displayName.length > 40 ||
      (phone && (phone.length < 7 || phone.length > 30))
    ) {
      return ownerAccessJsonResponse({ error: "invalid_request" }, 400);
    }
    await ownerRpc<null>(context, "owner_update_hidden_test_member_profile", {
      p_display_name: displayName,
      p_phone: phone,
    });
    return ownerAccessJsonResponse({ updated: true });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}
