import "server-only";

export interface TrackingResult {
  isDelivered: boolean;
  statusText: string;
  deliveredTime?: string;
}

const TRACK_QUERY = `query Track($carrierId: ID!, $trackingNumber: String!) {
  track(carrierId: $carrierId, trackingNumber: $trackingNumber) {
    lastEvent { time status { code name } }
  }
}`;

const COURIER_IDS: Record<string, string> = {
  "CJ대한통운": "kr.cjlogistics",
  "우체국택배": "kr.epost",
  "로젠택배": "kr.logen",
  "한진택배": "kr.hanjin",
  "롯데택배": "kr.lotte",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function resolveTrackerCarrierId(courier: string, storedCarrierId?: string | null) {
  const stored = storedCarrierId?.trim();
  if (stored) return stored;
  return COURIER_IDS[courier.trim()] ?? null;
}

export async function checkDeliveryStatus(
  carrierId: string,
  trackingNumber: string,
): Promise<TrackingResult> {
  const clientId = process.env.TRACKER_DELIVERY_CLIENT_ID?.trim();
  const clientSecret = process.env.TRACKER_DELIVERY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("courier_tracker_configuration_missing");

  const response = await fetch("https://apis.tracker.delivery/graphql", {
    method: "POST",
    headers: {
      Authorization: `TRACKQL-API-KEY ${clientId}:${clientSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: TRACK_QUERY, variables: { carrierId, trackingNumber } }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok || !isRecord(payload) || (Array.isArray(payload.errors) && payload.errors.length > 0)) {
    throw new Error(`courier_tracker_request_failed:${response.status}`);
  }
  const data = isRecord(payload.data) ? payload.data : null;
  const track = data && isRecord(data.track) ? data.track : null;
  const event = track && isRecord(track.lastEvent) ? track.lastEvent : null;
  const status = event && isRecord(event.status) ? event.status : null;
  const code = typeof status?.code === "string" ? status.code.trim().toLowerCase() : "";
  const statusText = typeof status?.name === "string" && status.name.trim() ? status.name.trim() : "배송중";
  const deliveredTime = typeof event?.time === "string" && Number.isFinite(Date.parse(event.time))
    ? new Date(event.time).toISOString()
    : undefined;
  const isDelivered = code === "delivered";
  return { isDelivered, statusText, deliveredTime: isDelivered ? deliveredTime ?? new Date().toISOString() : undefined };
}
