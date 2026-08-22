export type NotificationCategory = "ALL" | "AUCTION" | "VAULT_SHIPPING" | "OPERATOR_SALES" | "OWNER_SETTLEMENT" | "NOTICE";

export type NotificationType =
  | "AUCTION_OUTBID" | "AUCTION_WON" | "AUCTION_DROP_ALERT"
  | "VAULT_EXPIRING_SOON" | "ORDER_SHIPPED" | "NOTICE_GENERAL"
  | "SELLER_NEW_SALE" | "SELLER_SHIPPING_REQUEST" | "SELLER_NEW_INQUIRY"
  | "OWNER_DEPOSIT_VERIFY" | "OWNER_SETTLEMENT_REQUEST" | "OWNER_SECURITY_ALERT";

export type NotificationAudienceRole = "member" | "operator" | "employee" | "owner";
export type NotificationViewerRole = NotificationAudienceRole;
export type NotificationUserRole = "USER" | "OPERATOR" | "OWNER";

export interface NotificationRecord { audience_role: string; body: string; created_at: string; href: string | null; id: string; kind: string; read_at: string | null; title: string; }
export interface NotificationTabDefinition { emptyLabel: string; id: NotificationCategory; label: string; roles: readonly NotificationViewerRole[]; }

export const NOTIFICATION_TABS: readonly NotificationTabDefinition[] = [
  { id: "ALL", label: "전체", emptyLabel: "새로운 알림이 없습니다.", roles: ["member", "operator", "employee", "owner"] },
  { id: "AUCTION", label: "경매", emptyLabel: "새로운 경매 알림이 없습니다.", roles: ["member", "operator", "employee", "owner"] },
  { id: "VAULT_SHIPPING", label: "보관·배송", emptyLabel: "새로운 보관·배송 알림이 없습니다.", roles: ["member", "operator", "employee", "owner"] },
  { id: "NOTICE", label: "공지", emptyLabel: "새로운 공지사항이 없습니다.", roles: ["member", "operator", "employee", "owner"] },
  { id: "OPERATOR_SALES", label: "판매·출고", emptyLabel: "처리할 판매·배송 요청이 없습니다.", roles: ["operator", "employee", "owner"] },
  { id: "OWNER_SETTLEMENT", label: "정산·시스템", emptyLabel: "처리할 정산·시스템 알림이 없습니다.", roles: ["owner"] },
] as const;

const CANONICAL_CATEGORY: Record<NotificationType, Exclude<NotificationCategory, "ALL">> = {
  AUCTION_OUTBID: "AUCTION", AUCTION_WON: "AUCTION", AUCTION_DROP_ALERT: "AUCTION",
  VAULT_EXPIRING_SOON: "VAULT_SHIPPING", ORDER_SHIPPED: "VAULT_SHIPPING", NOTICE_GENERAL: "NOTICE",
  SELLER_NEW_SALE: "OPERATOR_SALES", SELLER_SHIPPING_REQUEST: "OPERATOR_SALES", SELLER_NEW_INQUIRY: "OPERATOR_SALES",
  OWNER_DEPOSIT_VERIFY: "OWNER_SETTLEMENT", OWNER_SETTLEMENT_REQUEST: "OWNER_SETTLEMENT", OWNER_SECURITY_ALERT: "OWNER_SETTLEMENT",
};
const LEGACY_KIND_ALIASES: Record<string, NotificationType> = { VAULT_EXPIRING: "VAULT_EXPIRING_SOON", OWNER_SETTLEMENT_REQ: "OWNER_SETTLEMENT_REQUEST" };

export function normalizeNotificationRole(role: string | null | undefined): NotificationViewerRole {
  if (role === "owner" || role === "operator" || role === "employee") return role;
  return "member";
}
export function getVisibleNotificationTabs(role: NotificationViewerRole) { return NOTIFICATION_TABS.filter((tab) => tab.roles.includes(role)); }

export function getNotificationCategory(kind: string, audienceRole = "member"): Exclude<NotificationCategory, "ALL"> {
  const normalizedKind = kind.toUpperCase();
  const canonicalKind = LEGACY_KIND_ALIASES[normalizedKind] ?? normalizedKind as NotificationType;
  const canonical = CANONICAL_CATEGORY[canonicalKind];
  if (canonical) return canonical;
  const audience = normalizeNotificationRole(audienceRole);
  if (audience === "owner" && /deposit|settlement|payment_verification|reconciliation|security/iu.test(kind)) return "OWNER_SETTLEMENT";
  if ((audience === "operator" || audience === "employee") && /sale|order|shipping_request|shipping_requested|shipment|inquiry|chat_message/iu.test(kind)) return "OPERATOR_SALES";
  if (/auction|bid|winner|won|outbid|offer/iu.test(kind)) return "AUCTION";
  if (/storage|vault|shipping|shipment|delivery|tracking|payment_confirmed/iu.test(kind)) return "VAULT_SHIPPING";
  return "NOTICE";
}

export function canViewNotification(viewerRole: NotificationViewerRole, audienceRole: string, kind = "NOTICE_GENERAL") {
  const category = getNotificationCategory(kind, audienceRole);
  if (category === "OWNER_SETTLEMENT" && viewerRole !== "owner") return false;
  if (category === "OPERATOR_SALES" && !["owner", "operator", "employee"].includes(viewerRole)) return false;
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

export function getNotificationFallbackHref(kind: string) {
  const normalizedKind = LEGACY_KIND_ALIASES[kind.toUpperCase()] ?? kind.toUpperCase() as NotificationType;
  switch (normalizedKind) {
    case "AUCTION_OUTBID": return "/live";
    case "AUCTION_WON": return "/my?tab=auction&sub=won";
    case "AUCTION_DROP_ALERT": return "/live";
    case "VAULT_EXPIRING_SOON": return "/my/vault";
    case "ORDER_SHIPPED": return "/my/orders";
    case "SELLER_NEW_SALE": return "/admin/operator/orders";
    case "SELLER_SHIPPING_REQUEST": return "/admin/operator/vault";
    case "SELLER_NEW_INQUIRY": return "/admin/operator/inquiries";
    case "OWNER_DEPOSIT_VERIFY": return "/admin/owner/settlements?tab=deposits";
    case "OWNER_SETTLEMENT_REQUEST": return "/admin/owner/settlements?tab=payouts";
    case "OWNER_SECURITY_ALERT": return "/admin/owner/audit-logs";
    default: return null;
  }
}
