import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "./client";

interface ManualBankAccountRow {
  bank_name: string | null;
  account_number: string | null;
  active_mode: "manual_transfer" | "portone";
  configured: boolean;
  updated_at: string | null;
}

interface ManualTransferRow {
  order_id: string;
  product_id: string;
  product_title: string;
  image_urls: string[] | null;
  buyer_display_name: string | null;
  bank_name: string;
  account_number: string;
  expected_amount: number;
  status: string;
  requested_at: string;
  confirmed_at: string | null;
  updated_at: string;
  total_count: number;
  due_at: string | null;
  purchase_offer_kind: "original" | "second_chance" | null;
  purchase_offer_status: string | null;
  purchase_offer_round: number | null;
  payment_deadline_exempt: boolean;
}

interface BegunManualTransferRow {
  order_id: string;
  product_id: string;
  order_name: string;
  expected_amount: number;
  status: string;
  bank_name: string;
  account_number: string;
  requested_at: string;
  confirmed_at: string | null;
  updated_at: string;
  is_payment_settled: boolean;
}

export interface ManualBankAccount {
  bankName: string;
  accountNumber: string;
  activeMode: "manual_transfer" | "portone";
  configured: boolean;
  updatedAt: string | null;
}

export interface BegunManualTransfer {
  orderId: string;
  productId: string;
  orderName: string;
  expectedAmount: number;
  status: string;
  bankName: string;
  accountNumber: string;
  requestedAt: string;
  confirmedAt: string | null;
  updatedAt: string;
  isPaymentSettled: boolean;
}

export interface PendingManualTransfer {
  orderId: string;
  productId: string;
  productTitle: string;
  productImageUrl: string | null;
  buyerDisplayName: string;
  bankName: string;
  accountNumber: string;
  expectedAmount: number;
  status: string;
  requestedAt: string;
  confirmedAt: string | null;
  updatedAt: string;
  totalCount: number;
  dueAt: string | null;
  purchaseOfferKind: "original" | "second_chance" | null;
  purchaseOfferStatus: string | null;
  purchaseOfferRound: number | null;
  paymentDeadlineExempt: boolean;
}

export class ManualPaymentError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ManualPaymentError";
  }
}

function client(): SupabaseClient {
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

function repositoryError(
  error: Pick<PostgrestError, "code" | "message">,
  fallback: string,
): ManualPaymentError {
  const denied =
    error.code === "42501" ||
    /permission|authorized|권한/i.test(error.message ?? "");
  return new ManualPaymentError(
    denied ? "이 작업을 수행할 권한이 없습니다." : error.message || fallback,
    { cause: error },
  );
}

function normalizeAccount(row: ManualBankAccountRow): ManualBankAccount {
  return {
    bankName: row.bank_name?.trim() ?? "",
    accountNumber: row.account_number?.trim() ?? "",
    activeMode: row.active_mode,
    configured: Boolean(row.configured),
    updatedAt: row.updated_at ?? null,
  };
}

function firstRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return value && typeof value === "object" ? (value as T) : null;
}

function assertUuid(value: string, label: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new ManualPaymentError(`${label}가 올바르지 않습니다.`);
  }
}

/**
 * 계좌를 보여 주는 순간 서버가 낙찰자를 다시 확인하고
 * 입금 진행 중 원장을 생성합니다. 계좌는 이 RPC 성공 전에 노출하지 않습니다.
 */
export async function beginManualBankTransfer(
  productId: string,
): Promise<BegunManualTransfer> {
  assertUuid(productId, "상품 식별자");
  const { data, error } = await client().rpc("begin_manual_transfer", {
    p_product_id: productId,
  });
  if (error) {
    throw repositoryError(error, "계좌이체 안내를 시작하지 못했습니다.");
  }
  const row = firstRow<BegunManualTransferRow>(data);
  if (!row) throw new ManualPaymentError("입금 계좌를 확인하지 못했습니다.");
  const expectedAmount = Number(row.expected_amount);
  if (
    !Number.isSafeInteger(expectedAmount) ||
    expectedAmount < 1 ||
    !row.bank_name?.trim() ||
    !row.account_number?.trim()
  ) {
    throw new ManualPaymentError("입금 계좌 응답이 올바르지 않습니다.");
  }
  return {
    orderId: row.order_id,
    productId: row.product_id,
    orderName: row.order_name,
    expectedAmount,
    status: row.status,
    bankName: row.bank_name.trim(),
    accountNumber: row.account_number.trim(),
    requestedAt: row.requested_at,
    confirmedAt: row.confirmed_at,
    updatedAt: row.updated_at,
    isPaymentSettled: Boolean(row.is_payment_settled),
  };
}

export async function getManualBankAccountForStaff(): Promise<ManualBankAccount | null> {
  const { data, error } = await client().rpc("get_manual_transfer_settings");
  if (error) throw repositoryError(error, "공용 입금 계좌를 불러오지 못했습니다.");
  const row = firstRow<ManualBankAccountRow>(data);
  return row ? normalizeAccount(row) : null;
}

export async function updateManualBankAccount(input: {
  bankName: string;
  accountNumber: string;
}): Promise<ManualBankAccount> {
  const bankName = input.bankName.trim();
  const accountNumber = input.accountNumber.trim();
  if (bankName.length < 2 || bankName.length > 40) {
    throw new ManualPaymentError("은행명은 2~40자로 입력해 주세요.");
  }
  if (
    accountNumber.length < 5 ||
    accountNumber.length > 50 ||
    !/^[0-9 -]+$/.test(accountNumber)
  ) {
    throw new ManualPaymentError(
      "계좌번호는 숫자와 하이픈으로 5~50자를 입력해 주세요.",
    );
  }

  const { data, error } = await client().rpc("update_manual_transfer_settings", {
    p_bank_name: bankName,
    p_account_number: accountNumber,
  });
  if (error) throw repositoryError(error, "공용 입금 계좌를 저장하지 못했습니다.");
  const row = firstRow<ManualBankAccountRow>(data);
  if (!row) throw new ManualPaymentError("저장된 입금 계좌를 확인하지 못했습니다.");
  return normalizeAccount(row);
}

export async function getPendingManualTransfers(): Promise<PendingManualTransfer[]> {
  const { data, error } = await client().rpc("get_pending_manual_transfers", {
    p_limit: 100,
    p_offset: 0,
  });
  if (error) throw repositoryError(error, "입금 확인 대기 목록을 불러오지 못했습니다.");
  return ((data ?? []) as ManualTransferRow[]).map((row) => {
    const amount = Number(row.expected_amount);
    if (!Number.isSafeInteger(amount) || amount < 1) {
      throw new ManualPaymentError("입금 확인 금액이 올바르지 않습니다.");
    }
    const dueAt = row.due_at ?? null;
    if (dueAt !== null && !Number.isFinite(Date.parse(dueAt))) {
      throw new ManualPaymentError("입금 확인 기한이 올바르지 않습니다.");
    }
    const purchaseOfferRound =
      row.purchase_offer_round === null
        ? null
        : Number(row.purchase_offer_round);
    if (
      purchaseOfferRound !== null &&
      (!Number.isInteger(purchaseOfferRound) ||
        purchaseOfferRound < 1 ||
        purchaseOfferRound > 2)
    ) {
      throw new ManualPaymentError("구매 기회 회차가 올바르지 않습니다.");
    }
    return {
      orderId: row.order_id,
      productId: row.product_id,
      productTitle: row.product_title,
      productImageUrl:
        Array.isArray(row.image_urls) && typeof row.image_urls[0] === "string"
          ? row.image_urls[0]
          : null,
      buyerDisplayName: row.buyer_display_name?.trim() || "회원",
      bankName: row.bank_name.trim(),
      accountNumber: row.account_number.trim(),
      expectedAmount: amount,
      status: row.status,
      requestedAt: row.requested_at,
      confirmedAt: row.confirmed_at,
      updatedAt: row.updated_at,
      totalCount: Number(row.total_count),
      dueAt,
      purchaseOfferKind: row.purchase_offer_kind,
      purchaseOfferStatus: row.purchase_offer_status,
      purchaseOfferRound,
      paymentDeadlineExempt: Boolean(row.payment_deadline_exempt),
    };
  });
}

export async function confirmManualBankTransfer(input: {
  orderId: string;
  expectedUpdatedAt: string;
}): Promise<void> {
  const { orderId, expectedUpdatedAt } = input;
  assertUuid(orderId, "결제 원장 식별자");
  if (!Number.isFinite(Date.parse(expectedUpdatedAt))) {
    throw new ManualPaymentError("입금 요청의 수정 시각을 확인하지 못했습니다.");
  }
  const { error } = await client().rpc("confirm_manual_transfer", {
    p_order_id: orderId,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) throw repositoryError(error, "입금 확정을 완료하지 못했습니다.");
}
