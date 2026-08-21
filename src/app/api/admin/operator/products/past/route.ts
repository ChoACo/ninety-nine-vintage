import type { SupabaseClient } from "@supabase/supabase-js";

import {
  authenticateOperatorStoreRequest,
  commerceJson,
  normalizeIds,
} from "@/lib/commerce/server";
import { getCatalogImageUrl } from "@/lib/images";

interface ClosedAuctionWinnerState {
  winnerAmount: number | null;
  winnerDueAt: string | null;
  winnerKind: string | null;
  winnerName: string | null;
  winnerState: "awaiting_payment" | "completed" | "none" | "unpaid_expired";
}

const LIVE_OFFER_STATUSES = new Set(["payment_due", "offered", "accepted"]);

function resolveWinnerState(
  offers: Array<{
    bidder_display_name_snapshot?: string;
    offer_kind?: string;
    offered_amount?: number;
    offered_at?: string;
    payment_due_at?: string | null;
    response_due_at?: string | null;
    status?: string;
  }>,
): ClosedAuctionWinnerState {
  const sorted = [...offers].sort((left, right) =>
    (right.offered_at ?? "").localeCompare(left.offered_at ?? ""),
  );
  const live = sorted.find((offer) => LIVE_OFFER_STATUSES.has(offer.status ?? ""));
  if (live) {
    return {
      winnerAmount: live.offered_amount ?? null,
      winnerDueAt: live.payment_due_at ?? live.response_due_at ?? null,
      winnerKind: live.offer_kind ?? null,
      winnerName: live.bidder_display_name_snapshot ?? null,
      winnerState: "awaiting_payment",
    };
  }
  if (sorted.some((offer) => offer.status === "settled")) {
    return {
      winnerAmount: null,
      winnerDueAt: null,
      winnerKind: null,
      winnerName: null,
      winnerState: "completed",
    };
  }
  const expired = sorted.find(
    (offer) =>
      offer.offer_kind === "original" && offer.status === "expired_unpaid",
  );
  if (expired) {
    return {
      winnerAmount: expired.offered_amount ?? null,
      winnerDueAt: expired.payment_due_at ?? expired.response_due_at ?? null,
      winnerKind: "original",
      winnerName: expired.bidder_display_name_snapshot ?? null,
      winnerState: "unpaid_expired",
    };
  }
  return {
    winnerAmount: null,
    winnerDueAt: null,
    winnerKind: null,
    winnerName: null,
    winnerState: "none",
  };
}

export async function GET(request: Request) {
  const auth = await authenticateOperatorStoreRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner" && auth.roleCode !== "operator") {
    return commerceJson({ error: "past_products_forbidden" }, 403);
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
      return commerceJson({ error: "past_products_unavailable" }, 503);
    }
    const membershipStoreIds = (membershipResult.data ?? []).map(
      (membership) => membership.store_id,
    );
    allowedStoreIds = [...new Set(membershipStoreIds)];
  }
  let storeQuery = admin
    .from("stores")
    .select("id, name, slug, operator_id")
    .eq("is_active", true)
    .eq("id", auth.selectedStoreId);
  if (allowedStoreIds) {
    if (allowedStoreIds.length === 0) {
      return commerceJson({
        canProcessSecondChance: false,
        closedAuctions: [],
        paymentMode: null,
        products: [],
        stores: [],
      });
    }
    storeQuery = storeQuery.in("id", allowedStoreIds);
  }
  const { data: stores, error: storeError } = await storeQuery.order("name");
  if (storeError)
    return commerceJson({ error: "past_products_unavailable" }, 503);
  const storeIds = (stores ?? []).map((store) => store.id);
  if (storeIds.length === 0) {
    return commerceJson({
      canProcessSecondChance: false,
      closedAuctions: [],
      paymentMode: null,
      products: [],
      stores: [],
    });
  }
const now = new Date().toISOString();
  const [pastResult, closedResult] = await Promise.all([
    auth.admin
      .from("products")
      .select("*, stores(id, name, slug)")
      .eq("sale_type", "auction")
      .eq("past_action", "pending")
      .gt("past_expires_at", now)
      .in("store_id", storeIds)
      .order("past_at", { ascending: false }),
    auth.admin
      .from("products")
      .select(
        "id, title, current_price, image_urls, thumbnail_urls, store_id, closes_at, status, sale_type, stores(id, name, slug)",
      )
      .eq("sale_type", "auction")
      .eq("status", "closed")
      .in("store_id", storeIds)
      .order("closes_at", { ascending: false }),
  ]);
  if (pastResult.error) {
    return commerceJson({ error: "past_products_unavailable" }, 503);
  }
  if (closedResult.error) {
    return commerceJson({ error: "closed_auctions_unavailable" }, 503);
  }
  const closedAuctions = closedResult.data ?? [];
  const closedIds = closedAuctions.map((product) => product.id);
  const offersByProduct = new Map<string, ReturnType<typeof resolveWinnerState>>();
  if (closedIds.length > 0) {
    const { data: offerRows, error: offerError } = await auth.admin
      .from("auction_purchase_offers")
      .select(
        "product_id, offer_kind, status, offered_amount, offered_at, payment_due_at, response_due_at, bidder_display_name_snapshot",
      )
      .in("product_id", closedIds)
      .order("offered_at", { ascending: false });
    if (offerError) {
      return commerceJson({ error: "closed_auction_offers_unavailable" }, 503);
    }
    const grouped = new Map<string, Array<Record<string, unknown>>>();
    for (const offer of offerRows ?? []) {
      const bucket = grouped.get(offer.product_id) ?? [];
      bucket.push(offer);
      grouped.set(offer.product_id, bucket);
    }
    for (const [productId, offers] of grouped) {
      offersByProduct.set(productId, resolveWinnerState(offers));
    }
  }
  const { data: lockData, error: lockError } = await auth.user
    .rpc("get_operator_pending_product_locks", { p_store_ids: storeIds });
  if (lockError) {
    return commerceJson({ error: "past_products_unavailable" }, 503);
  }
  const lockRows = (Array.isArray(lockData) ? lockData : []) as Array<{
    productId: string;
    lockKind: "buy_now_payment" | "auction_payment";
    lockUntil: string | null;
  }>;
  const locksByProduct = new Map(lockRows.map((lock) => [lock.productId, lock]));
  const enrichWithLock = (product: Record<string, unknown>) => {
    const lock = locksByProduct.get(product.id as string);
    return lock
      ? { ...product, pending_lock_kind: lock.lockKind, pending_lock_until: lock.lockUntil }
      : product;
  };
  return commerceJson({
    stores: stores ?? [],
    products: (pastResult.data ?? []).map((product) => ({
      ...product,
      image_urls: product.image_urls.map((image) =>
        getCatalogImageUrl(image, 320),
      ),
      thumbnail_urls: product.thumbnail_urls.map((image) =>
        getCatalogImageUrl(image, 320),
      ),
    })),
    closedAuctions: closedAuctions.map((product) =>
      enrichWithLock({
        ...product,
        image_urls: product.image_urls.map((image) =>
          getCatalogImageUrl(image, 320),
        ),
        thumbnail_urls: product.thumbnail_urls.map((image) =>
          getCatalogImageUrl(image, 320),
        ),
        ...(offersByProduct.get(product.id) ?? {
          winnerAmount: null,
          winnerDueAt: null,
          winnerKind: null,
          winnerName: null,
          winnerState: "none",
        }),
      }),
    ),
    canProcessSecondChance:
      auth.roleCode === "owner" || auth.roleCode === "operator",
    paymentMode: "manual_transfer",
  });
}

export async function POST(request: Request) {
  const auth = await authenticateOperatorStoreRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const productIds = normalizeIds(body?.productIds);
  const action =
    body?.action === "delete"
      ? "delete"
      : body?.action === "relist"
        ? "relist"
        : "";
  if (productIds.length === 0 || productIds.length > 200 || !action) {
    return commerceJson({ error: "상품과 작업을 확인해 주세요." }, 400);
  }
  const { data: scopedProducts, error: scopeError } = await auth.user
    .from("products")
    .select("id")
    .in("id", productIds)
    .eq("store_id", auth.selectedStoreId);
  if (scopeError) return commerceJson({ error: "past_products_unavailable" }, 503);
  if ((scopedProducts ?? []).length !== productIds.length) {
    return commerceJson({ error: "operator_store_scope_mismatch" }, 403);
  }
  const { data, error } = await auth.user
    .rpc("manage_past_auction_products", {
      p_product_ids: productIds,
      p_action: action,
    })
    .single();
  if (error)
    return commerceJson(
      { error: error.message || "지난 상품을 처리하지 못했습니다." },
      409,
    );
  return commerceJson({ result: data });
}
