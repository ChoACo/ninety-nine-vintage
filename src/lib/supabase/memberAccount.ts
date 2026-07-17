import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "./client";

export type WonProductShippingStatus = "ready" | "requested" | "shipped";

export interface MemberAccount {
  memberId: string;
  phone: string | null;
  shippingCreditCount: number;
  accountStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemberShippingAddress {
  id: string;
  memberId: string;
  label: string;
  recipientName: string;
  phone: string;
  address: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MemberWonProduct {
  productId: string;
  title: string;
  imageUrls: string[];
  closedAt: string;
  finalBidAmount: number;
  shippingStatus: WonProductShippingStatus;
  shipmentRequestId: string | null;
}

export interface SaveShippingAddressInput {
  id?: string | null;
  label: string;
  recipientName: string;
  phone: string;
  address: string;
  isDefault: boolean;
}

interface MemberAccountRow {
  member_id: string;
  phone: string | null;
  shipping_credit_count: number;
  account_status: string;
  created_at: string;
  updated_at: string;
}

interface ShippingAddressRow {
  id: string;
  member_id: string;
  label: string;
  recipient_name: string;
  phone: string;
  address: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

interface WonProductRow {
  product_id: string;
  title: string;
  image_urls: string[];
  closed_at: string;
  final_bid_amount: number;
  shipping_status: WonProductShippingStatus;
  shipment_request_id: string | null;
}

export class MemberAccountError extends Error {
  readonly code?: string;

  constructor(message: string, options?: { cause?: unknown; code?: string }) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "MemberAccountError";
    this.code = options?.code;
  }
}

function getMemberAccountClient(): SupabaseClient {
  // These tables can be deployed before the generated Database interface is
  // refreshed. Every result is normalized below instead of leaking raw rows.
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

function throwQueryError(
  error: { message: string; code?: string } | null,
  fallbackMessage: string,
): void {
  if (!error) return;
  throw new MemberAccountError(fallbackMessage, {
    cause: error,
    code: error.code,
  });
}

function requireNonEmpty(value: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) throw new MemberAccountError(`${label}을(를) 입력해 주세요.`);
  if (normalized.length > maxLength) {
    throw new MemberAccountError(`${label}은(는) ${maxLength}자 이하로 입력해 주세요.`);
  }
  return normalized;
}

function toMemberAccount(row: MemberAccountRow): MemberAccount {
  const shippingCreditCount = Number(row.shipping_credit_count);
  if (!Number.isInteger(shippingCreditCount) || shippingCreditCount < 0) {
    throw new MemberAccountError("택배 가능 횟수 데이터가 올바르지 않습니다.");
  }

  return {
    memberId: row.member_id,
    phone: row.phone,
    shippingCreditCount,
    accountStatus: row.account_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toShippingAddress(row: ShippingAddressRow): MemberShippingAddress {
  return {
    id: row.id,
    memberId: row.member_id,
    label: row.label,
    recipientName: row.recipient_name,
    phone: row.phone,
    address: row.address,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toWonProduct(row: WonProductRow): MemberWonProduct {
  if (!(["ready", "requested", "shipped"] as const).includes(row.shipping_status)) {
    throw new MemberAccountError("낙찰 상품의 배송 상태가 올바르지 않습니다.");
  }

  const finalBidAmount = Number(row.final_bid_amount);
  if (!Number.isSafeInteger(finalBidAmount) || finalBidAmount < 0) {
    throw new MemberAccountError("낙찰 금액 데이터가 올바르지 않습니다.");
  }

  return {
    productId: row.product_id,
    title: row.title,
    imageUrls: Array.isArray(row.image_urls)
      ? row.image_urls.filter((url): url is string => typeof url === "string")
      : [],
    closedAt: row.closed_at,
    finalBidAmount,
    shippingStatus: row.shipping_status,
    shipmentRequestId: row.shipment_request_id,
  };
}

export async function fetchMyMemberAccount(
  memberId: string,
): Promise<MemberAccount | null> {
  const { data, error } = await getMemberAccountClient()
    .from("member_accounts")
    .select(
      "member_id, phone, shipping_credit_count, account_status, created_at, updated_at",
    )
    .eq("member_id", memberId)
    .maybeSingle();

  throwQueryError(error, "회원 배송 계정을 불러오지 못했습니다.");
  return data ? toMemberAccount(data as MemberAccountRow) : null;
}

export async function fetchMyShippingAddresses(
  memberId: string,
): Promise<MemberShippingAddress[]> {
  const { data, error } = await getMemberAccountClient()
    .from("shipping_addresses")
    .select(
      "id, member_id, label, recipient_name, phone, address, is_default, created_at, updated_at",
    )
    .eq("member_id", memberId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  throwQueryError(error, "배송지 목록을 불러오지 못했습니다.");
  return ((data ?? []) as ShippingAddressRow[]).map(toShippingAddress);
}

export async function fetchMyWonProducts(): Promise<MemberWonProduct[]> {
  const { data, error } = await getMemberAccountClient().rpc(
    "get_my_won_products",
  );

  throwQueryError(error, "낙찰 상품을 불러오지 못했습니다.");
  if (!Array.isArray(data)) {
    throw new MemberAccountError("낙찰 상품 응답 형식이 올바르지 않습니다.");
  }
  return (data as WonProductRow[]).map(toWonProduct);
}

export async function saveMyShippingAddress(
  input: SaveShippingAddressInput,
): Promise<void> {
  const label = requireNonEmpty(input.label, "배송지 이름", 40);
  const recipientName = requireNonEmpty(input.recipientName, "받는 분", 80);
  const phone = requireNonEmpty(input.phone, "연락처", 30);
  const address = requireNonEmpty(input.address, "주소", 500);
  if (phone.length < 7) {
    throw new MemberAccountError("연락처는 7자 이상 입력해 주세요.");
  }
  if (address.length < 5) {
    throw new MemberAccountError("주소는 5자 이상 입력해 주세요.");
  }

  const { error } = await getMemberAccountClient().rpc(
    "upsert_my_shipping_address",
    {
      p_id: input.id ?? null,
      p_label: label,
      p_recipient_name: recipientName,
      p_phone: phone,
      p_address: address,
      p_is_default: input.isDefault,
    },
  );

  throwQueryError(error, "배송지를 저장하지 못했습니다.");
}

export async function deleteMyShippingAddress(addressId: string): Promise<void> {
  if (!addressId) throw new MemberAccountError("삭제할 배송지를 찾지 못했습니다.");

  const { error } = await getMemberAccountClient().rpc(
    "delete_my_shipping_address",
    { p_address_id: addressId },
  );
  throwQueryError(error, "배송지를 삭제하지 못했습니다.");
}

export async function requestMyProductShipping(
  productIds: readonly string[],
  addressId: string,
): Promise<string> {
  const uniqueProductIds = [...new Set(productIds.filter(Boolean))];
  if (uniqueProductIds.length === 0) {
    throw new MemberAccountError("택배로 받을 상품을 선택해 주세요.");
  }
  if (!addressId) {
    throw new MemberAccountError("택배를 받을 배송지를 선택해 주세요.");
  }

  const { data, error } = await getMemberAccountClient().rpc(
    "request_product_shipping",
    {
      p_product_ids: uniqueProductIds,
      p_address_id: addressId,
    },
  );

  throwQueryError(error, "택배 접수를 완료하지 못했습니다.");
  if (typeof data !== "string" || !data) {
    throw new MemberAccountError("택배 접수 결과를 확인하지 못했습니다.");
  }
  return data;
}
