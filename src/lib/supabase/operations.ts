import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "./client";

export type MemberAccountStatus = "active" | "suspended";
export type ManagedAccessRole =
  | "operator"
  | "employee"
  | "band_member"
  | "member";

interface MemberDirectoryRow {
  id: string;
  display_name: string | null;
  legal_name: string | null;
  email: string | null;
  phone: string | null;
  gender: "female" | "male" | null;
  birth_year: number | null;
  kakao_profile_complete: boolean;
  kakao_synced_at: string | null;
  account_status: MemberAccountStatus;
  shipping_credit_count: number;
  address_count: number;
  bid_count: number;
  support_status: "open" | "closed" | null;
  created_at: string;
  last_seen_at: string | null;
  access_role: ManagedAccessRole;
  warning_count: number;
  sanction_count: number;
  bid_blocked_until: string | null;
  payment_deadline_exempt: boolean;
}

interface OperatorDirectoryRow {
  id: string;
  display_name: string | null;
  email: string | null;
  last_seen_at: string | null;
}

interface DailyRevenueRow {
  revenue_date: string;
  gross_amount: number;
  paid_order_count: number;
  updated_at: string;
}

interface WarningResultRow {
  warning_count: number;
  sanction_count: number;
  bid_blocked_until: string | null;
  cancelled_bid_count: number;
}

export interface StaffMemberDirectoryEntry {
  id: string;
  displayName: string | null;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  gender: "female" | "male" | null;
  birthYear: number | null;
  kakaoProfileComplete: boolean;
  kakaoSyncedAt: string | null;
  accountStatus: MemberAccountStatus;
  shippingCreditCount: number;
  addressCount: number;
  bidCount: number;
  supportStatus: "open" | "closed" | null;
  createdAt: string;
  lastSeenAt: string | null;
  accessRole: ManagedAccessRole;
  warningCount: number;
  sanctionCount: number;
  bidBlockedUntil: string | null;
  paymentDeadlineExempt: boolean;
}

export interface OperatorDirectoryEntry {
  id: string;
  displayName: string | null;
  email: string | null;
  lastSeenAt: string | null;
}

export interface DailyRevenueEntry {
  revenueDate: string;
  grossAmount: number;
  paidOrderCount: number;
  updatedAt: string;
}

export interface WarningResult {
  warningCount: number;
  sanctionCount: number;
  bidBlockedUntil: string | null;
  cancelledBidCount: number;
}

export class OperationsRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OperationsRepositoryError";
  }
}

function getOperationsClient(): SupabaseClient {
  // These RPCs are shipped in the access-control migration. Keeping the
  // boundary local avoids coupling the UI to a generated type snapshot.
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

function toRepositoryError(
  error: Pick<PostgrestError, "code" | "message">,
  fallbackMessage: string,
): OperationsRepositoryError {
  const normalizedMessage = error.message.toLowerCase();
  const isPermissionError =
    error.code === "42501" ||
    normalizedMessage.includes("permission") ||
    normalizedMessage.includes("authorized") ||
    normalizedMessage.includes("권한");

  return new OperationsRepositoryError(
    isPermissionError
      ? "이 작업을 수행할 권한이 없습니다. 운영 권한을 확인해 주세요."
      : error.message || fallbackMessage,
    { cause: error },
  );
}

function assertUuid(value: string, label = "식별자") {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new OperationsRepositoryError(`${label}가 올바르지 않습니다.`);
  }
}

function assertDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new OperationsRepositoryError("날짜 형식이 올바르지 않습니다.");
  }
}

function mapMemberDirectoryRow(
  row: MemberDirectoryRow,
): StaffMemberDirectoryEntry {
  return {
    id: row.id,
    displayName: row.display_name,
    legalName: row.legal_name,
    email: row.email,
    phone: row.phone,
    gender: row.gender,
    birthYear: row.birth_year,
    kakaoProfileComplete: row.kakao_profile_complete,
    kakaoSyncedAt: row.kakao_synced_at,
    accountStatus: row.account_status,
    shippingCreditCount: row.shipping_credit_count,
    addressCount: Number(row.address_count),
    bidCount: Number(row.bid_count),
    supportStatus: row.support_status,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    accessRole: row.access_role,
    warningCount: row.warning_count,
    sanctionCount: row.sanction_count,
    bidBlockedUntil: row.bid_blocked_until,
    paymentDeadlineExempt: row.payment_deadline_exempt,
  };
}

function mapDailyRevenue(row: DailyRevenueRow): DailyRevenueEntry {
  return {
    revenueDate: row.revenue_date,
    grossAmount: Number(row.gross_amount),
    paidOrderCount: row.paid_order_count,
    updatedAt: row.updated_at,
  };
}

export async function getStaffMemberDirectory(): Promise<
  StaffMemberDirectoryEntry[]
> {
  const pageSize = 500;
  const maximumMembers = 50_000;
  const rows: MemberDirectoryRow[] = [];

  for (let offset = 0; offset < maximumMembers; offset += pageSize) {
    const { data, error } = await getOperationsClient().rpc(
      "get_staff_member_directory",
      { p_limit: pageSize, p_offset: offset },
    );
    if (error) {
      throw toRepositoryError(
        error,
        "회원 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    }

    const page = (data ?? []) as MemberDirectoryRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
    if (offset + pageSize >= maximumMembers) {
      throw new OperationsRepositoryError(
        "회원 수가 조회 안전 한도를 초과했습니다. 서버 검색 API로 전환해 주세요.",
      );
    }
  }

  return rows
    .map(mapMemberDirectoryRow)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function getOwnerOperatorDirectory(): Promise<
  OperatorDirectoryEntry[]
> {
  const { data, error } = await getOperationsClient().rpc(
    "get_owner_operator_directory",
  );
  if (error) {
    throw toRepositoryError(error, "운영자 목록을 불러오지 못했습니다.");
  }
  return ((data ?? []) as OperatorDirectoryRow[]).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    lastSeenAt: row.last_seen_at,
  }));
}

export async function setMemberAccessRole(
  memberId: string,
  role: ManagedAccessRole,
): Promise<ManagedAccessRole> {
  assertUuid(memberId, "회원 식별자");
  const { data, error } = await getOperationsClient().rpc(
    "set_member_access_role",
    { p_member_id: memberId, p_role_code: role },
  );
  if (error) throw toRepositoryError(error, "회원 등급을 변경하지 못했습니다.");
  if (data !== role) {
    throw new OperationsRepositoryError("변경된 회원 등급을 확인하지 못했습니다.");
  }
  return data;
}

export async function updateManagedMember(
  memberId: string,
  displayName: string,
  phone: string,
): Promise<void> {
  assertUuid(memberId, "회원 식별자");
  const { error } = await getOperationsClient().rpc("update_managed_member", {
    p_member_id: memberId,
    p_display_name: displayName.trim(),
    p_phone: phone.trim(),
  });
  if (error) throw toRepositoryError(error, "회원 정보를 수정하지 못했습니다.");
}

export async function deleteManagedMember(memberId: string): Promise<void> {
  assertUuid(memberId, "회원 식별자");
  const { error } = await getOperationsClient().rpc("delete_managed_member", {
    p_member_id: memberId,
  });
  if (error) throw toRepositoryError(error, "회원 정보를 삭제하지 못했습니다.");
}

export async function addMemberWarning(
  memberId: string,
  category: "general" | "late_payment",
  reason: string,
): Promise<WarningResult> {
  assertUuid(memberId, "회원 식별자");
  const { data, error } = await getOperationsClient().rpc(
    "add_member_warning",
    { p_member_id: memberId, p_category: category, p_reason: reason.trim() },
  );
  if (error) throw toRepositoryError(error, "경고를 등록하지 못했습니다.");
  const row = (data as WarningResultRow[] | null)?.[0];
  if (!row) throw new OperationsRepositoryError("경고 처리 결과를 확인하지 못했습니다.");
  return {
    warningCount: row.warning_count,
    sanctionCount: row.sanction_count,
    bidBlockedUntil: row.bid_blocked_until,
    cancelledBidCount: row.cancelled_bid_count,
  };
}

export async function setMemberAccountStatus(
  memberId: string,
  status: MemberAccountStatus,
): Promise<MemberAccountStatus> {
  assertUuid(memberId, "회원 식별자");
  const { data, error } = await getOperationsClient().rpc(
    "set_member_account_status",
    { p_member_id: memberId, p_status: status },
  );
  if (error) throw toRepositoryError(error, "회원 상태를 변경하지 못했습니다.");
  if (data !== "active" && data !== "suspended") {
    throw new OperationsRepositoryError("변경된 회원 상태를 확인하지 못했습니다.");
  }
  return data;
}

export async function adjustMemberShippingCredits(
  memberId: string,
  delta: number,
): Promise<number> {
  assertUuid(memberId, "회원 식별자");
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100) {
    throw new OperationsRepositoryError(
      "배송 이용권 변경 수량은 1개 이상 100개 이하의 정수여야 합니다.",
    );
  }
  const { data, error } = await getOperationsClient().rpc(
    "adjust_member_shipping_credits",
    { p_member_id: memberId, p_delta: delta },
  );
  if (error) throw toRepositoryError(error, "배송 이용권 수량을 변경하지 못했습니다.");
  if (!Number.isInteger(data) || data < 0) {
    throw new OperationsRepositoryError("변경된 배송 이용권 수량을 확인하지 못했습니다.");
  }
  return data;
}

export async function getDailyRevenue(
  fromDate: string,
  toDate: string,
): Promise<DailyRevenueEntry[]> {
  assertDateKey(fromDate);
  assertDateKey(toDate);
  const { data, error } = await getOperationsClient().rpc("get_daily_revenue", {
    p_from: fromDate,
    p_to: toDate,
  });
  if (error) throw toRepositoryError(error, "매출 정보를 불러오지 못했습니다.");
  return ((data ?? []) as DailyRevenueRow[]).map(mapDailyRevenue);
}

export async function upsertDailyRevenue(input: {
  revenueDate: string;
  grossAmount: number;
  paidOrderCount: number;
}): Promise<DailyRevenueEntry> {
  assertDateKey(input.revenueDate);
  if (
    !Number.isSafeInteger(input.grossAmount) ||
    input.grossAmount < 0 ||
    !Number.isSafeInteger(input.paidOrderCount) ||
    input.paidOrderCount < 0
  ) {
    throw new OperationsRepositoryError("매출액과 결제 건수를 확인해 주세요.");
  }
  const { data, error } = await getOperationsClient().rpc(
    "upsert_daily_revenue",
    {
      p_revenue_date: input.revenueDate,
      p_gross_amount: input.grossAmount,
      p_paid_order_count: input.paidOrderCount,
    },
  );
  if (error) throw toRepositoryError(error, "일 매출을 저장하지 못했습니다.");
  const row = (data as DailyRevenueRow[] | null)?.[0];
  if (!row) throw new OperationsRepositoryError("저장된 매출을 확인하지 못했습니다.");
  return mapDailyRevenue(row);
}
