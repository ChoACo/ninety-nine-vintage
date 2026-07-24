export type NotificationConsentState = "pending" | "granted" | "declined";

export interface NotificationPreferences {
  auctionEnabled: boolean;
  backgroundPushEnabled: boolean;
  chatEnabled: boolean;
  consentState: NotificationConsentState;
  foregroundEnabled: boolean;
  paymentVerificationEnabled: boolean;
  shipmentEnabled: boolean;
  shippingRequestEnabled: boolean;
  systemEnabled: boolean;
}

export interface NotificationPreferencesResponse {
  preferences: NotificationPreferences;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  auctionEnabled: true,
  backgroundPushEnabled: true,
  chatEnabled: true,
  consentState: "pending",
  foregroundEnabled: true,
  paymentVerificationEnabled: true,
  shipmentEnabled: true,
  shippingRequestEnabled: true,
  systemEnabled: true,
};

export const NOTIFICATION_CATEGORY_OPTIONS = [
  {
    description: "낙찰 결과와 결제 기한 안내",
    key: "auctionEnabled",
    label: "낙찰 알림",
  },
  {
    description: "회원과 매장 사이의 새 상담 메시지",
    key: "chatEnabled",
    label: "채팅 알림",
  },
  {
    description: "택배사와 송장번호 등록 안내",
    key: "shipmentEnabled",
    label: "송장 등록 알림",
  },
  {
    description: "운영자·직원의 입금 확인 업무",
    key: "paymentVerificationEnabled",
    label: "입금 확인 요청",
  },
  {
    description: "운영자·직원의 새 배송 신청 업무",
    key: "shippingRequestEnabled",
    label: "배송 요청 알림",
  },
  {
    description: "결제 취소 등 그 밖의 중요한 안내",
    key: "systemEnabled",
    label: "기타 중요 알림",
  },
] as const satisfies ReadonlyArray<{
  description: string;
  key: NotificationPreferenceToggleKey;
  label: string;
}>;

export type NotificationPreferenceToggleKey =
  | "auctionEnabled"
  | "chatEnabled"
  | "paymentVerificationEnabled"
  | "shipmentEnabled"
  | "shippingRequestEnabled"
  | "systemEnabled";

export function isNotificationCategoryEnabled(
  preferences: NotificationPreferences,
  kind: string,
) {
  switch (kind) {
    case "auction_won":
      return preferences.auctionEnabled;
    case "chat_message":
      return preferences.chatEnabled;
    case "shipment_tracking_registered":
      return preferences.shipmentEnabled;
    case "payment_verification_requested":
      return preferences.paymentVerificationEnabled;
    case "shipping_requested":
      return preferences.shippingRequestEnabled;
    default:
      return preferences.systemEnabled;
  }
}

export function isNotificationKindEnabled(
  preferences: NotificationPreferences,
  kind: string,
) {
  return (
    preferences.consentState === "granted" &&
    preferences.foregroundEnabled &&
    isNotificationCategoryEnabled(preferences, kind)
  );
}
