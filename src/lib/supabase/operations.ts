import type { PostgrestError } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "./client";
import type {
  Database,
  MemberAccountStatus as DatabaseMemberAccountStatus,
} from "./database.types";

export type MemberAccountStatus = DatabaseMemberAccountStatus;

type MemberDirectoryRow =
  Database["public"]["Functions"]["get_staff_member_directory"]["Returns"][number];

export interface StaffMemberDirectoryEntry {
  id: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  accountStatus: MemberAccountStatus;
  shippingCreditCount: number;
  addressCount: number;
  bidCount: number;
  supportStatus: "open" | "closed" | null;
  createdAt: string;
  lastSignInAt: string | null;
}

export class OperationsRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OperationsRepositoryError";
  }
}

function mapMemberDirectoryRow(
  row: MemberDirectoryRow,
): StaffMemberDirectoryEntry {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    phone: row.phone,
    accountStatus: row.account_status,
    shippingCreditCount: row.shipping_credit_count,
    addressCount: row.address_count,
    bidCount: row.bid_count,
    supportStatus: row.support_status,
    createdAt: row.created_at,
    lastSignInAt: row.last_sign_in_at,
  };
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
      ? "이 작업을 수행할 권한이 없습니다. 운영 스태프 권한을 확인해 주세요."
      : error.message || fallbackMessage,
    { cause: error },
  );
}

function assertUuid(memberId: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      memberId,
    )
  ) {
    throw new OperationsRepositoryError("회원 식별자가 올바르지 않습니다.");
  }
}

export async function getStaffMemberDirectory(): Promise<
  StaffMemberDirectoryEntry[]
> {
  const pageSize = 500;
  const maximumMembers = 50_000;
  const rows: MemberDirectoryRow[] = [];

  for (let offset = 0; offset < maximumMembers; offset += pageSize) {
    const { data, error } = await getSupabaseBrowserClient().rpc(
      "get_staff_member_directory",
      { p_limit: pageSize, p_offset: offset },
    );
    if (error) {
      throw toRepositoryError(
        error,
        "회원 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    }

    const page = data ?? [];
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

export async function setMemberAccountStatus(
  memberId: string,
  status: MemberAccountStatus,
): Promise<MemberAccountStatus> {
  assertUuid(memberId);
  const { data, error } = await getSupabaseBrowserClient().rpc(
    "set_member_account_status",
    {
      p_member_id: memberId,
      p_status: status,
    },
  );

  if (error) {
    throw toRepositoryError(
      error,
      "회원 상태를 변경하지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
  }

  if (data !== "active" && data !== "suspended") {
    throw new OperationsRepositoryError(
      "변경된 회원 상태를 확인하지 못했습니다. 목록을 새로고침해 주세요.",
    );
  }
  return data;
}

export async function adjustMemberShippingCredits(
  memberId: string,
  delta: number,
): Promise<number> {
  assertUuid(memberId);
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100) {
    throw new OperationsRepositoryError(
      "배송 이용권 변경 수량은 1개 이상 100개 이하의 정수여야 합니다.",
    );
  }

  const { data, error } = await getSupabaseBrowserClient().rpc(
    "adjust_member_shipping_credits",
    {
      p_member_id: memberId,
      p_delta: delta,
    },
  );

  if (error) {
    throw toRepositoryError(
      error,
      "배송 이용권 수량을 변경하지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
  }

  if (!Number.isInteger(data) || data < 0) {
    throw new OperationsRepositoryError(
      "변경된 배송 이용권 수량을 확인하지 못했습니다. 목록을 새로고침해 주세요.",
    );
  }
  return data;
}
