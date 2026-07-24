import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationConsentState,
  type NotificationPreferences,
} from "@/lib/notifications/preferences";
import {
  authenticateCommerceRequest,
  commerceJson,
} from "@/lib/commerce/server";

interface PreferenceRow {
  auction_enabled: boolean;
  background_push_enabled: boolean;
  chat_enabled: boolean;
  consent_state: string;
  foreground_enabled: boolean;
  payment_verification_enabled: boolean;
  shipment_enabled: boolean;
  shipping_request_enabled: boolean;
  system_enabled: boolean;
}

const preferenceColumns =
  "consent_state, foreground_enabled, background_push_enabled, auction_enabled, chat_enabled, shipment_enabled, payment_verification_enabled, shipping_request_enabled, system_enabled";

function mapPreferences(row: PreferenceRow | null): NotificationPreferences {
  if (!row) return DEFAULT_NOTIFICATION_PREFERENCES;
  const consentState: NotificationConsentState =
    row.consent_state === "granted" || row.consent_state === "declined"
      ? row.consent_state
      : "pending";
  return {
    auctionEnabled: row.auction_enabled,
    backgroundPushEnabled: row.background_push_enabled,
    chatEnabled: row.chat_enabled,
    consentState,
    foregroundEnabled: row.foreground_enabled,
    paymentVerificationEnabled: row.payment_verification_enabled,
    shipmentEnabled: row.shipment_enabled,
    shippingRequestEnabled: row.shipping_request_enabled,
    systemEnabled: row.system_enabled,
  };
}

function normalizePreferences(body: unknown): NotificationPreferences | null {
  if (!body || typeof body !== "object") return null;
  const candidate = body as Partial<NotificationPreferences>;
  if (
    candidate.consentState !== "granted" &&
    candidate.consentState !== "declined"
  ) {
    return null;
  }
  const booleanKeys = [
    "auctionEnabled",
    "backgroundPushEnabled",
    "chatEnabled",
    "foregroundEnabled",
    "paymentVerificationEnabled",
    "shipmentEnabled",
    "shippingRequestEnabled",
    "systemEnabled",
  ] as const;
  if (booleanKeys.some((key) => typeof candidate[key] !== "boolean")) {
    return null;
  }
  const normalized = candidate as NotificationPreferences;
  if (normalized.consentState === "declined") {
    return {
      ...normalized,
      backgroundPushEnabled: false,
      foregroundEnabled: false,
    };
  }
  return normalized;
}

export async function GET(request: Request) {
  const auth = await authenticateCommerceRequest(request);
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.user
    .from("notification_preferences")
    .select(preferenceColumns)
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (error) {
    return commerceJson({ error: "notification_preferences_unavailable" }, 503);
  }
  return commerceJson({ preferences: mapPreferences(data as PreferenceRow | null) });
}

export async function POST(request: Request) {
  const auth = await authenticateCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const preferences = normalizePreferences(
    await request.json().catch(() => null),
  );
  if (!preferences) {
    return commerceJson(
      {
        error: "invalid_notification_preferences",
        message: "알림 설정을 다시 확인해 주세요.",
      },
      400,
    );
  }

  const { data, error } = await auth.user
    .from("notification_preferences")
    .upsert(
      {
        user_id: auth.userId,
        consent_state: preferences.consentState,
        foreground_enabled: preferences.foregroundEnabled,
        background_push_enabled: preferences.backgroundPushEnabled,
        auction_enabled: preferences.auctionEnabled,
        chat_enabled: preferences.chatEnabled,
        shipment_enabled: preferences.shipmentEnabled,
        payment_verification_enabled:
          preferences.paymentVerificationEnabled,
        shipping_request_enabled: preferences.shippingRequestEnabled,
        system_enabled: preferences.systemEnabled,
        consented_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select(preferenceColumns)
    .single();
  if (error) {
    return commerceJson({ error: "notification_preferences_save_failed" }, 503);
  }
  return commerceJson({ preferences: mapPreferences(data as PreferenceRow) });
}
