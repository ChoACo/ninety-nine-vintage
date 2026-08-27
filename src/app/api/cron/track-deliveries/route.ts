import "server-only";

import { NextResponse } from "next/server";
import { checkDeliveryStatus, resolveTrackerCarrierId } from "@/lib/shipping/courierTracker";
import { createSupabaseServerClients } from "@/lib/supabase/server";

export const maxDuration = 60;

interface TrackingCandidate {
  shipmentId: string;
  courier: string;
  trackerCarrierId: string | null;
  trackingNumber: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCandidate(value: unknown): value is TrackingCandidate {
  return isRecord(value) && typeof value.shipmentId === "string" && typeof value.courier === "string" &&
    (value.trackerCarrierId === null || typeof value.trackerCarrierId === "string") &&
    typeof value.trackingNumber === "string";
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  const { admin } = createSupabaseServerClients();
  const envAuthorized = Boolean(cronSecret) && provided === cronSecret;
  const vaultVerification = !envAuthorized && provided
    ? await admin.rpc("verify_web_push_dispatch_secret", { p_secret: provided })
    : { data: false, error: null };
  if (!envAuthorized && (vaultVerification.error || vaultVerification.data !== true)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.TRACKER_DELIVERY_CLIENT_ID?.trim() || !process.env.TRACKER_DELIVERY_CLIENT_SECRET?.trim()) {
    return NextResponse.json({ error: "courier_tracker_configuration_missing" }, { status: 503 });
  }

  const { data, error } = await admin.rpc("get_pending_inventory_delivery_tracking", { p_limit: 20 });
  const rawShipments: unknown = isRecord(data) ? data.shipments : null;
  if (error || !Array.isArray(rawShipments) || !rawShipments.every(isCandidate)) {
    return NextResponse.json({ error: "tracking_queue_unavailable" }, { status: 503 });
  }
  const shipments: TrackingCandidate[] = rawShipments;

  const results = await Promise.allSettled(shipments.map(async (shipment) => {
    const carrierId = resolveTrackerCarrierId(shipment.courier, shipment.trackerCarrierId);
    if (!carrierId) {
      await admin.rpc("record_inventory_delivery_tracking", {
        p_shipment_id: shipment.shipmentId,
        p_expected_tracking_number: shipment.trackingNumber,
        p_tracker_carrier_id: "",
        p_status_text: "택배사 확인 필요",
        p_delivered_at: null,
        p_error: "unsupported_courier",
      });
      return { delivered: false, unsupported: true };
    }
    try {
      const tracking = await checkDeliveryStatus(carrierId, shipment.trackingNumber);
      const recorded = await admin.rpc("record_inventory_delivery_tracking", {
        p_shipment_id: shipment.shipmentId,
        p_expected_tracking_number: shipment.trackingNumber,
        p_tracker_carrier_id: carrierId,
        p_status_text: tracking.statusText,
        p_delivered_at: tracking.deliveredTime ?? null,
        p_error: null,
      });
      if (recorded.error) throw recorded.error;
      return { delivered: tracking.isDelivered, unsupported: false };
    } catch (trackingError) {
      const message = trackingError instanceof Error ? trackingError.message : "courier_tracker_failed";
      await admin.rpc("record_inventory_delivery_tracking", {
        p_shipment_id: shipment.shipmentId,
        p_expected_tracking_number: shipment.trackingNumber,
        p_tracker_carrier_id: carrierId,
        p_status_text: "조회 실패",
        p_delivered_at: null,
        p_error: message.slice(0, 500),
      });
      throw trackingError;
    }
  }));

  const delivered = results.filter((result) => result.status === "fulfilled" && result.value.delivered).length;
  const failed = results.filter((result) => result.status === "rejected").length;
  return NextResponse.json({ success: failed === 0, processed: shipments.length, delivered, failed }, {
    status: failed === 0 ? 200 : 207,
  });
}
