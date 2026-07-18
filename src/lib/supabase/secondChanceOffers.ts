import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "./client";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface SecondChanceOfferRow {
  offer_id: string;
  product_id: string;
  product_title: string;
  image_urls: unknown;
  offered_amount: number;
  offered_at: string;
  expires_at: string;
  status: string;
}

export interface SecondChanceOffer {
  offerId: string;
  productId: string;
  productTitle: string;
  imageUrl: string | null;
  offeredAmount: number;
  offeredAt: string;
  expiresAt: string;
}

export interface ClaimedSecondChanceOffer {
  offerId: string;
  productId: string;
  status: "accepted";
  paymentDueAt: string | null;
}

export class SecondChanceOfferError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SecondChanceOfferError";
  }
}

function client(): SupabaseClient {
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

function assertOfferId(offerId: string): void {
  if (!UUID_PATTERN.test(offerId)) {
    throw new SecondChanceOfferError("차순위 구매 기회 정보가 올바르지 않습니다.");
  }
}

function firstRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return value && typeof value === "object" ? (value as T) : null;
}

function errorMessage(error: { message?: string } | null, fallback: string) {
  return error?.message?.trim() || fallback;
}

export async function fetchMySecondChanceOffers(): Promise<SecondChanceOffer[]> {
  const { data, error } = await client().rpc("get_my_second_chance_offers");
  if (error) {
    throw new SecondChanceOfferError(
      errorMessage(error, "차순위 구매 기회를 확인하지 못했습니다."),
      { cause: error },
    );
  }
  if (!Array.isArray(data)) return [];

  return (data as SecondChanceOfferRow[]).map((row) => {
    const amount = Number(row.offered_amount);
    const expiresAt = Date.parse(row.expires_at);
    if (
      !UUID_PATTERN.test(row.offer_id) ||
      !UUID_PATTERN.test(row.product_id) ||
      typeof row.product_title !== "string" ||
      row.product_title.trim().length === 0 ||
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      !Number.isFinite(Date.parse(row.offered_at)) ||
      !Number.isFinite(expiresAt) ||
      row.status !== "offered"
    ) {
      throw new SecondChanceOfferError("차순위 구매 기회 응답이 올바르지 않습니다.");
    }

    const imageUrl = Array.isArray(row.image_urls)
      ? row.image_urls.find((value): value is string => typeof value === "string") ?? null
      : null;
    return Object.freeze({
      offerId: row.offer_id,
      productId: row.product_id,
      productTitle: row.product_title,
      imageUrl,
      offeredAmount: amount,
      offeredAt: row.offered_at,
      expiresAt: row.expires_at,
    });
  });
}

export async function claimSecondChanceOffer(
  offerId: string,
): Promise<ClaimedSecondChanceOffer> {
  assertOfferId(offerId);
  const { data, error } = await client().rpc("claim_my_second_chance_offer", {
    p_offer_id: offerId,
  });
  if (error) {
    throw new SecondChanceOfferError(
      errorMessage(error, "차순위 구매 기회를 수락하지 못했습니다."),
      { cause: error },
    );
  }

  const row = firstRow<{
    offer_id: string;
    product_id: string;
    status: string;
    payment_due_at: string | null;
  }>(data);
  if (
    !row ||
    row.offer_id !== offerId ||
    !UUID_PATTERN.test(row.product_id) ||
    row.status !== "accepted" ||
    (row.payment_due_at !== null &&
      !Number.isFinite(Date.parse(row.payment_due_at)))
  ) {
    throw new SecondChanceOfferError("수락된 구매 기회 응답이 올바르지 않습니다.");
  }
  return {
    offerId: row.offer_id,
    productId: row.product_id,
    status: "accepted",
    paymentDueAt: row.payment_due_at,
  };
}

export async function declineSecondChanceOffer(offerId: string): Promise<void> {
  assertOfferId(offerId);
  const { error } = await client().rpc("decline_my_second_chance_offer", {
    p_offer_id: offerId,
  });
  if (error) {
    throw new SecondChanceOfferError(
      errorMessage(error, "차순위 구매 기회를 거절하지 못했습니다."),
      { cause: error },
    );
  }
}
