export type NotificationType =
  | "AUCTION_OUTBID"
  | "AUCTION_WON"
  | "VAULT_EXPIRING"
  | "ORDER_SHIPPED"
  | "NOTICE_GENERAL"
  | "SELLER_NEW_SALE"
  | "SELLER_SHIPPING_REQUEST"
  | "SELLER_NEW_INQUIRY"
  | "OWNER_DEPOSIT_VERIFY"
  | "OWNER_SETTLEMENT_REQ";

export type NotificationAudienceRole =
  | "member"
  | "operator"
  | "employee"
  | "owner";

export type NotificationViewerRole = NotificationAudienceRole;

export type NotificationCategory =
  | "all"
  | "auction"
  | "shipping"
  | "notice"
  | "seller"
  | "owner";

export interface NotificationRecord {
  audience_role: string;
  body: string;
  created_at: string;
  href: string | null;
  id: string;
  kind: string;
  read_at: string | null;
  title: string;
}

export const NOTIFICATION_TABS: ReadonlyArray<{
  id: NotificationCategory;
  label: string;
  roles: readonly NotificationViewerRole[];
}> = [
  { id: "all", label: "전체", roles: ["member", "operator", "employee", "owner"] },
  { id: "auction", label: "경매", roles: ["member", "operator", "employee", "owner"] },
  { id: "shipping", label: "보관·배송", roles: ["member", "operator", "employee", "owner"] },
  { id: "notice", label: "공지", roles: ["member", "operator", "employee", "owner"] },
  { id: "seller", label: "판매·출고", roles: ["operator", "employee", "owner"] },
  { id: "owner", label: "정산·관리", roles: ["owner"] },
] as const;

const CANONICAL_CATEGORY: Record<NotificationType, Exclude<NotificationCategory, "all">> = {
  AUCTION_OUTBID: "auction",
  AUCTION_WON: "auction",
  VAULT_EXPIRING: "shipping",
  ORDER_SHIPPED: "shipping",
  NOTICE_GENERAL: "notice",
  SELLER_NEW_SALE: "seller",
  SELLER_SHIPPING_REQUEST: "seller",
  SELLER_NEW_INQUIRY: "seller",
  OWNER_DEPOSIT_VERIFY: "owner",
  OWNER_SETTLEMENT_REQ: "owner",
};

export function normalizeNotificationRole(role: string | null | undefined): NotificationViewerRole {
  if (role === "owner" || role === "operator" || role === "employee") return role;
  return "member";
}

export function getVisibleNotificationTabs(role: NotificationViewerRole) {
  return NOTIFICATION_TABS.filter((tab) => tab.roles.includes(role));
}

export function canViewNotification(
  viewerRole: NotificationViewerRole,
  audienceRole: string,
) {
  const audience = normalizeNotificationRole(audienceRole);
  if (viewerRole === "owner") return true;
  if (viewerRole === "operator") return audience === "member" || audience === "operator";
  if (viewerRole === "employee") return audience === "member" || audience === "employee";
  return audience === "member";
}

export function getVisibleNotificationAudiences(viewerRole: NotificationViewerRole) {
  if (viewerRole === "owner") return ["member", "operator", "employee", "owner"] as const;
  if (viewerRole === "operator") return ["member", "operator"] as const;
  if (viewerRole === "employee") return ["member", "employee"] as const;
  return ["member"] as const;
}

export function getNotificationCategory(
  kind: string,
  audienceRole: string,
): Exclude<NotificationCategory, "all"> {
  const canonical = CANONICAL_CATEGORY[kind.toUpperCase() as NotificationType];
  if (canonical) return canonical;

  const audience = normalizeNotificationRole(audienceRole);
  if (audience === "owner" && /deposit|settlement|payment_verification|reconciliation/iu.test(kind)) return "owner";
  if (
    (audience === "operator" || audience === "employee")
    && /sale|order|shipping_request|shipping_requested|shipment|inquiry|chat_message/iu.test(kind)
  ) return "seller";
  if (/auction|bid|winner|won|outbid|offer/iu.test(kind)) return "auction";
  if (/storage|vault|shipping|shipment|delivery|tracking|payment_confirmed/iu.test(kind)) return "shipping";
  return "notice";
}

export function getNotificationFallbackHref(kind: string) {
  switch (kind.toUpperCase() as NotificationType) {
    case "AUCTION_OUTBID": return "/live";
    case "AUCTION_WON": return "/my?tab=auction&sub=won";
    case "VAULT_EXPIRING": return "/my?tab=vault";
    case "ORDER_SHIPPED": return "/my?tab=orders";
    case "SELLER_NEW_SALE": return "/admin/operator/orders";
    case "SELLER_SHIPPING_REQUEST": return "/admin/operator/shipping";
    case "SELLER_NEW_INQUIRY": return "/admin/operator/chat";
    case "OWNER_DEPOSIT_VERIFY": return "/admin/owner/payments";
    case "OWNER_SETTLEMENT_REQ": return "/admin/owner/settlements";
    default: return null;
  }
}
