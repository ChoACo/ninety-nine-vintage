export type ManagedMemberRole =
  | "owner"
  | "operator"
  | "employee"
  | "band_member"
  | "member";

export type ManagedMemberStatus =
  | "active"
  | "suspended"
  | "temporary_suspended";

export interface ManagedMemberSanction {
  id: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  source: "automatic" | "manual";
}

export interface ManagedMember {
  id: string;
  display_name: string;
  legal_name: string | null;
  email: string | null;
  phone: string | null;
  account_status: ManagedMemberStatus;
  suspended_until: string | null;
  suspension_reason: string | null;
  shipping_credit_count: number | null;
  address_count: number;
  bid_count: number;
  created_at: string;
  last_seen_at: string | null;
  access_role: ManagedMemberRole;
  reports_to_operator_id: string | null;
  warning_count: number;
  sanction_count: number;
  bid_blocked_until: string | null;
  active_sanctions: ManagedMemberSanction[];
  is_deleted: false;
}

export interface WithdrawnMemberRetention {
  member_id: string;
  anonymized_reference: string;
  deletion_reason: string;
  deleted_at: string;
  purge_due_at: string;
  attempt_count: number;
  last_attempt_at: string | null;
  last_error_code: string | null;
  retention_status: "retained" | "due" | "failed";
}

export function normalizeManagementReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= 500
    ? normalized
    : null;
}

export function isManagedMemberStatus(
  value: unknown,
): value is ManagedMemberStatus {
  return (
    value === "active" ||
    value === "suspended" ||
    value === "temporary_suspended"
  );
}
