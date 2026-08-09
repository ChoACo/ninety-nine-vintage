import { commerceJson } from "@/lib/commerce/server";

// Legacy commerce tracking correction bypassed the v2 inventory shipment
// command path. It remains deliberately retired rather than providing a second
// write path into shipment state.
export function PATCH() {
  return commerceJson(
    {
      error: "legacy_shipment_retired",
      message: "기존 정식 배송 운송장 정정은 중단되었습니다.",
    },
    410,
  );
}
