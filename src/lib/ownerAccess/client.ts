export interface OwnerDelegationTarget {
  operator_id: string;
  display_name: string;
}

export interface OwnerDelegationSession {
  session_id: string;
  target_operator_id: string;
  target_display_name: string;
  reason: string;
  created_at: string;
  expires_at: string;
}

export interface OwnerHiddenTestMember {
  test_user_id: string;
  display_name: string;
  phone: string | null;
  shipping_credit_count: number;
  account_status: string;
  created_at: string;
  addresses: OwnerHiddenTestAddress[];
}

export interface OwnerHiddenTestAddress {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  address: string;
  isDefault: boolean;
}

export interface OwnerHiddenTestWonProduct {
  product_id: string;
  title: string;
  image_urls: string[];
  closed_at: string;
  final_bid_amount: number;
  shipping_status: "ready" | "requested" | "shipped";
  shipment_request_id: string | null;
  payment_id: string | null;
  payment_method: string | null;
  vbank_num: string | null;
  vbank_bank: string | null;
  vbank_due: string | null;
  payment_status: "대기중" | "가상계좌발급" | "결제완료";
  requested_method: string | null;
  portone_status: string | null;
}

export interface OwnerHiddenTestShippingRequest {
  request_id: string;
  status: "requested" | "shipped";
  courier: string | null;
  tracking_number: string | null;
  requested_at: string;
  shipped_at: string | null;
  address_snapshot: Record<string, unknown>;
  product_ids: string[];
}

export interface OwnerAuditEntry {
  audit_id: number;
  action: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}

async function ownerRequest<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error ?? "owner_access_failed");
  }
  return payload;
}

export function fetchOwnerDelegation(accessToken: string) {
  return ownerRequest<{
    targets: OwnerDelegationTarget[];
    current: OwnerDelegationSession | null;
    audit: OwnerAuditEntry[];
  }>(accessToken, "/api/owner/delegation");
}

export function beginOwnerDelegation(
  accessToken: string,
  operatorId: string,
  reason: string,
) {
  return ownerRequest<{ session: OwnerDelegationSession }>(
    accessToken,
    "/api/owner/delegation",
    { method: "POST", body: JSON.stringify({ operatorId, reason }) },
  );
}

export function endOwnerDelegation(accessToken: string, sessionId?: string) {
  return ownerRequest<{ ended: boolean }>(accessToken, "/api/owner/delegation", {
    method: "DELETE",
    body: JSON.stringify({ sessionId }),
  });
}

export function fetchOwnerHiddenTestMember(accessToken: string) {
  return ownerRequest<{
    member: OwnerHiddenTestMember | null;
    wonProducts: OwnerHiddenTestWonProduct[];
    shippingRequests: OwnerHiddenTestShippingRequest[];
    audit: OwnerAuditEntry[];
  }>(accessToken, "/api/owner/test-member");
}

export function updateOwnerHiddenTestProfile(
  accessToken: string,
  displayName: string,
  phone: string | null,
) {
  return ownerRequest<{ updated: true }>(accessToken, "/api/owner/test-member", {
    method: "PATCH",
    body: JSON.stringify({ displayName, phone }),
  });
}

export function setOwnerHiddenTestShippingCredits(
  accessToken: string,
  shippingCreditCount: number,
) {
  return ownerRequest<{ updated: true; shippingCreditCount: number }>(
    accessToken,
    "/api/owner/test-member",
    { method: "PATCH", body: JSON.stringify({ shippingCreditCount }) },
  );
}

export function upsertOwnerHiddenTestAddress(
  accessToken: string,
  address: {
    id?: string;
    label: string;
    recipientName: string;
    phone: string;
    address: string;
    isDefault?: boolean;
  },
) {
  return ownerRequest<{ address: unknown }>(
    accessToken,
    "/api/owner/test-member/addresses",
    { method: "PUT", body: JSON.stringify(address) },
  );
}

export function deleteOwnerHiddenTestAddress(
  accessToken: string,
  addressId: string,
) {
  return ownerRequest<{ deleted: boolean }>(
    accessToken,
    "/api/owner/test-member/addresses",
    { method: "DELETE", body: JSON.stringify({ addressId }) },
  );
}

export function requestOwnerHiddenTestShipping(
  accessToken: string,
  productIds: string[],
  addressId: string,
) {
  return ownerRequest<{ requestId: string }>(
    accessToken,
    "/api/owner/test-member/shipping",
    { method: "POST", body: JSON.stringify({ productIds, addressId }) },
  );
}

export function markOwnerHiddenTestShippingShipped(
  accessToken: string,
  requestId: string,
  courier: string,
  trackingNumber: string,
) {
  return ownerRequest<{ status: string }>(
    accessToken,
    "/api/owner/test-member/shipping",
    {
      method: "PATCH",
      body: JSON.stringify({ requestId, courier, trackingNumber }),
    },
  );
}
