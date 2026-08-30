import { authenticateOperatorStoreRequest, commerceJson } from "@/lib/commerce/server";
import { getCatalogImageUrl } from "@/lib/images";
import type { SupabaseClient } from "@supabase/supabase-js";

interface OfferRow {
  offer_id: string;
  product_id: string;
  offer_round: number;
  offer_kind: "original" | "second_chance";
  status: string;
  bidder_display_name_snapshot: string;
  offered_amount: number;
  offered_at: string;
  response_due_at: string | null;
  payment_due_at: string | null;
}

interface ProductRow {
  id: string;
  title: string;
  current_price: number;
  starting_price: number;
  image_urls: string[];
  thumbnail_urls: string[];
  store_id: string | null;
  closes_at: string;
  final_bid_amount: number | null;
  stores?: { name: string } | null;
}

interface RpcError {
  code?: string;
  message: string;
}

interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: RpcError | null }>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeOfferStatus(status: string): string {
  if (status === "payment_due") return "결제 대기";
  if (status === "offered") return "차순위 제안 대기";
  if (status === "accepted") return "차순위 수락 · 결제 대기";
  if (status === "settled") return "결제 완료";
  if (status === "expired_unpaid") return "결제 기한 초과 (미결제)";
  if (status === "declined") return "차순위 거절";
  if (status === "expired_offer") return "차순위 응답 기한 초과";
  if (status === "no_successor") return "차순위 대상 없음";
  return status;
}

export async function GET(request: Request) {
  const auth = await authenticateOperatorStoreRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner" && auth.roleCode !== "operator") {
    return commerceJson({ error: "unpaid_auctions_forbidden" }, 403);
  }
  const admin = auth.admin as unknown as SupabaseClient;

  const storeQuery = admin
    .from("stores")
    .select("id, name")
    .eq("is_active", true)
    .eq("id", auth.selectedStoreId);
  const { data: stores, error: storeError } = await storeQuery.order("name");
  if (storeError)
    return commerceJson({
      error: "unpaid_auctions_unavailable",
      message: "미결제 낙찰 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    }, 503);
  const storeIds = (stores ?? []).map((store) => store.id);
  if (storeIds.length === 0) {
    return commerceJson({ error: "unpaid_auctions_forbidden" }, 403);
  }

  const productQuery = admin
    .from("products")
    .select("id, title, current_price, starting_price, image_urls, thumbnail_urls, store_id, closes_at, final_bid_amount, stores(id, name)")
    .eq("sale_type", "auction")
    .eq("status", "closed")
    .is("past_at", null)
    .in("store_id", storeIds)
    .order("closes_at", { ascending: false });
  const { data: products, error: productError } = await productQuery;
  if (productError)
    return commerceJson({
      error: "unpaid_auctions_unavailable",
      message: "미결제 낙찰 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    }, 503);
  const productRows = (products ?? []) as unknown as ProductRow[];
  if (productRows.length === 0) {
    return commerceJson({ isOwner: auth.roleCode === "owner", products: [], stores: stores ?? [] });
  }

  const { data: offerRows, error: offerError } = await auth.user
    .rpc("get_operator_unpaid_auction_offers", { p_store_ids: storeIds });
  if (offerError)
    return commerceJson({
      error: "unpaid_auctions_unavailable",
      message: "미결제 낙찰 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    }, 503);
  const offersByProduct = new Map<string, OfferRow[]>();
  for (const offer of (offerRows ?? []) as OfferRow[]) {
    const list = offersByProduct.get(offer.product_id) ?? [];
    list.push(offer);
    offersByProduct.set(offer.product_id, list);
  }

  const now = Date.now();
  const productsPayload = productRows.map((product) => {
    const offers = offersByProduct.get(product.id) ?? [];
    const original = offers.find((offer) => offer.offer_kind === "original");
    const liveOffer = offers.find((offer) => {
      if (offer.status === "settled") return false;
      if (!["payment_due", "accepted", "offered"].includes(offer.status)) {
        return false;
      }
      const deadline = offer.status === "offered"
        ? (offer.response_due_at ?? offer.offered_at)
        : (offer.payment_due_at ?? offer.offered_at);
      return new Date(deadline).getTime() > now;
    });
    const hasSettled = offers.some((offer) => offer.status === "settled");
    const canResolve = Boolean(original) && !hasSettled && !liveOffer;
    const blockedReason = hasSettled
      ? "결제 완료된 낙찰입니다."
      : liveOffer
        ? liveOffer.offer_kind === "second_chance"
          ? "차순위 제안·결제 기한이 지나지 않았습니다."
          : "원 낙찰자의 결제 기한이 지나지 않았습니다."
        : original
          ? ""
          : "미결제 낙찰 원장이 없습니다.";
    const winner = original ?? offers[offers.length - 1];

    return {
      id: product.id,
      title: product.title,
      imageUrl: getCatalogImageUrl(product.image_urls?.[0] ?? "", 320),
      currentPrice: product.current_price,
      startingPrice: product.starting_price,
      finalBidAmount: product.final_bid_amount,
      closesAt: product.closes_at,
      storeName: product.stores?.name ?? "미지정 숍",
      winnerName: winner?.bidder_display_name_snapshot ?? null,
      winnerAmount: winner?.offered_amount ?? null,
      paymentDueAt: original?.payment_due_at ?? null,
      ownerForceOfferId: original?.offer_id ?? null,
      canOwnerForcePayment: auth.roleCode === "owner"
        && Boolean(original)
        && !hasSettled
        && ["payment_due", "accepted", "expired_unpaid"].includes(original?.status ?? ""),
      canResolve,
      canSecondChance: Boolean(original) && !hasSettled,
      blockedReason,
      offers: offers.map((offer) => ({
        id: offer.offer_id,
        offerKind: offer.offer_kind,
        status: offer.status,
        statusLabel: normalizeOfferStatus(offer.status),
        bidderDisplayName: offer.bidder_display_name_snapshot,
        offeredAmount: offer.offered_amount,
        offeredAt: offer.offered_at,
        responseDueAt: offer.response_due_at,
        paymentDueAt: offer.payment_due_at,
      })),
    };
  });

  return commerceJson({ isOwner: auth.roleCode === "owner", products: productsPayload, stores: stores ?? [] });
}

export async function POST(request: Request) {
  const auth = await authenticateOperatorStoreRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") {
    return commerceJson({ error: "owner_force_payment_forbidden" }, 403);
  }

  const body = await request.json().catch(() => null) as {
    action?: unknown;
    offerId?: unknown;
    depositorName?: unknown;
    includeInSettlement?: unknown;
    reason?: unknown;
    idempotencyKey?: unknown;
  } | null;
  const depositorName = typeof body?.depositorName === "string"
    ? body.depositorName.trim()
    : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (
    body?.action !== "force_confirm_payment"
    || typeof body.offerId !== "string"
    || !UUID_PATTERN.test(body.offerId)
    || typeof body.idempotencyKey !== "string"
    || !UUID_PATTERN.test(body.idempotencyKey)
    || typeof body.includeInSettlement !== "boolean"
    || depositorName.length < 1
    || depositorName.length > 80
    || reason.length < 3
    || reason.length > 500
  ) {
    return commerceJson({ error: "invalid_owner_force_payment" }, 422);
  }

  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    "owner_force_confirm_unpaid_auction_offer",
    {
      p_offer_id: body.offerId,
      p_depositor_name: depositorName,
      p_include_in_settlement: body.includeInSettlement,
      p_reason: reason,
      p_idempotency_key: body.idempotencyKey,
    },
  );
  if (error) {
    const status = error.code === "42501"
      ? 403
      : error.code === "23505" || error.code === "PT409"
        ? 409
        : ["22023", "55000", "P0002"].includes(error.code ?? "")
          ? 422
          : 503;
    return commerceJson(
      {
        error: "owner_force_payment_failed",
        message: error.message || "강제 결제완료를 처리하지 못했습니다.",
      },
      status,
    );
  }

  return commerceJson({ result: data });
}
