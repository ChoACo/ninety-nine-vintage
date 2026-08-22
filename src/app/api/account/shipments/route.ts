import { authenticateMemberCommerceRequest, commerceJson } from "@/lib/commerce/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

type ShipmentConfirmationRow = {
  shipment_id: string;
  confirmation_due_at: string | null;
  confirmed_at: string | null;
  confirmed_by_kind: "member" | "automatic" | null;
};

type ShipmentConfirmationQuery = {
  select: (columns: string) => {
    eq: (column: string, value: unknown) => {
      in: (column: string, values: string[]) => Promise<{
        data: ShipmentConfirmationRow[] | null;
        error: { message?: string } | null;
      }>;
    };
  };
};

type ShipmentConfirmationAdminClient = {
  from: (table: "inventory_shipment_trade_confirmations") => ShipmentConfirmationQuery;
};

type DeliveryStateRow = {
  id: string;
  delivery_status: string;
  delivery_status_text: string | null;
  delivered_at: string | null;
  auto_settle_at: string | null;
};

type DeliveryStateAdminClient = {
  from: (table: "inventory_shipments") => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        in: (column: string, values: string[]) => Promise<{
          data: DeliveryStateRow[] | null;
          error: { message?: string } | null;
        }>;
      };
    };
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isTimestamp(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function isTrackingUrl(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "www.hanjin.com";
  } catch {
    return false;
  }
}

function isShipmentItem(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, [
    "inventoryItemId", "productId", "title", "imageUrl",
  ]) && (value.inventoryItemId === null || isUuid(value.inventoryItemId)) && isUuid(value.productId) &&
    typeof value.title === "string" && typeof value.imageUrl === "string";
}

function isShipment(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, [
    "id", "sourceKind", "sourceId", "settlementMethod", "shippingFeeStatus",
    "publicStatus", "itemCount", "activeItemCount", "courier", "trackingNumber", "trackingUrl",
    "requestedAt", "addressSnapshot", "items",
  ]) && isUuid(value.id) &&
    (value.sourceKind === "inventory_v2" || value.sourceKind === "canonical_commerce") &&
    isUuid(value.sourceId) &&
    typeof value.settlementMethod === "string" && typeof value.shippingFeeStatus === "string" &&
    (value.publicStatus === "preparing" || value.publicStatus === "shipped") &&
    Number.isSafeInteger(value.itemCount) && Number(value.itemCount) >= 0 &&
    Number.isSafeInteger(value.activeItemCount) && Number(value.activeItemCount) >= 0 &&
    (value.courier === null || typeof value.courier === "string") &&
    (value.trackingNumber === null || typeof value.trackingNumber === "string") &&
    isTrackingUrl(value.trackingUrl) && isTimestamp(value.requestedAt) &&
    (value.addressSnapshot === null || isRecord(value.addressSnapshot)) &&
    Array.isArray(value.items) && value.items.every(isShipmentItem);
}

function isShipmentOverview(value: unknown): value is { shipments: Record<string, unknown>[] } {
  return isRecord(value) && hasExactKeys(value, ["shipments"]) &&
    Array.isArray(value.shipments) && value.shipments.every(isShipment);
}

export async function GET(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request);
  if (!auth.ok) return auth.response;
  const { data, error } = await (auth.user as unknown as RpcClient).rpc("get_my_inventory_shipments");
  if (error || !isShipmentOverview(data)) return commerceJson({ error: "shipment_history_unavailable" }, 503);
  const shipmentIds = data.shipments.map((shipment) => String(shipment.id));
  const confirmationResult = shipmentIds.length === 0
    ? { data: [], error: null }
    : await (auth.admin as unknown as ShipmentConfirmationAdminClient).from("inventory_shipment_trade_confirmations")
        .select("shipment_id,confirmation_due_at,confirmed_at,confirmed_by_kind")
        .eq("member_id", auth.userId)
        .in("shipment_id", shipmentIds);
  if (confirmationResult.error) return commerceJson({ error: "shipment_confirmation_unavailable" }, 503);
  const confirmationByShipment = new Map((confirmationResult.data ?? []).map((row) => [row.shipment_id, row]));
  const deliveryResult = shipmentIds.length === 0
    ? { data: [], error: null }
    : await (auth.admin as unknown as DeliveryStateAdminClient).from("inventory_shipments")
        .select("id,delivery_status,delivery_status_text,delivered_at,auto_settle_at")
        .eq("member_id", auth.userId)
        .in("id", shipmentIds);
  if (deliveryResult.error) return commerceJson({ error: "shipment_delivery_state_unavailable" }, 503);
  const deliveryByShipment = new Map((deliveryResult.data ?? []).map((row) => [row.id, row]));
  return commerceJson({
    shipments: data.shipments.map((shipment) => {
      const confirmation = confirmationByShipment.get(String(shipment.id));
      const delivery = deliveryByShipment.get(String(shipment.id));
      return {
        ...shipment,
        deliveryStatus: delivery?.delivery_status ?? null,
        deliveryStatusText: delivery?.delivery_status_text ?? null,
        deliveredAt: delivery?.delivered_at ?? null,
        autoSettleAt: delivery?.auto_settle_at ?? null,
        purchaseConfirmationDueAt: delivery?.delivered_at ? confirmation?.confirmation_due_at ?? null : null,
        purchaseConfirmedAt: confirmation?.confirmed_at ?? null,
        purchaseConfirmedBy: confirmation?.confirmed_by_kind ?? null,
      };
    }),
  });
}

export async function POST(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as { shipmentId?: unknown } | null;
  if (!body || !isUuid(body.shipmentId) || Object.keys(body).some((key) => key !== "shipmentId")) {
    return commerceJson({ error: "invalid_purchase_confirmation" }, 422);
  }
  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    "confirm_my_inventory_shipment_purchase",
    { p_shipment_id: body.shipmentId },
  );
  if (error || data !== true) {
    return commerceJson({ error: error?.message ?? "purchase_confirmation_failed" }, error?.code === "42501" ? 403 : 409);
  }
  return commerceJson({ confirmed: true });
}
