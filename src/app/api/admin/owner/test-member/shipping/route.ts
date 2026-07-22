import { ownerAccessJsonResponse } from "@/src/lib/ownerAccess/server";

// Hidden test-member shipping bypassed the canonical order and fulfillment
// state machine. It remains deliberately retired rather than providing a
// second write path into shipment state.
export function POST() {
  return ownerAccessJsonResponse({ error: "test_member_shipping_retired" }, 410);
}

export function PATCH() {
  return ownerAccessJsonResponse({ error: "test_member_shipping_retired" }, 410);
}
