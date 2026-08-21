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

  let allowedStoreIds: string[] | null = null;
  if (auth.roleCode === "operator") {
    const membershipResult = await admin
      .from("store_memberships")
      .select("store_id")
      .eq("user_id", auth.userId)
      .eq("status", "active")
      .eq("manage_products", true);
    if (membershipResult.error) {
      return commerceJson({ error: "unpaid_auctions_unavailable" }, 503);
    }
    allowedStoreIds = [...new Set(
      (membershipResult.data ?? []).map((membership) => membership.store_id),
    )];
    if (allowedStoreIds.length === 0) {
      return commerceJson({ error: "unpaid_auctions_forbidden" }, 403);
    }
  }

  let storeQuery = admin
    .from("stores")
    .select("id, name")
    .eq("is_active", true)
    .eq("id", auth.selectedStoreId);
  if (allowedStoreIds) storeQuery = storeQuery.in("id", allowedStoreIds);
  const { data: stores, error: storeError } = await storeQuery.order("name");
  if (storeError)
    return commerceJson({ error: "unpaid_auctions_unavailable" }, 503);
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
    return commerceJson({ error: "unpaid_auctions_unavailable" }, 503);
  const productRows = (products ?? []) as unknown as ProductRow[];
  if (productRows.length === 0) {
    return commerceJson({ products: [], stores: stores ?? [] });
  }

  const { data: offerRows, error: offerError } = await auth.user
    .rpc("get_operator_unpaid_auction_offers", { p_store_ids: storeIds });
  if (offerError)
    return commerceJson({ error: "unpaid_auctions_unavailable" }, 503);
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

  return commerceJson({ products: productsPayload, stores: stores ?? [] });
}