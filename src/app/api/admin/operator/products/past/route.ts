import type { SupabaseClient } from "@supabase/supabase-js";

import {
  authenticateStaffRequest,
  commerceJson,
  normalizeIds,
} from "@/lib/commerce/server";
import { getCatalogImageUrl } from "@/lib/images";

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
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
    .eq("is_active", true);
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
  const [pastResult, closedResult, paymentModeResult] = await Promise.all([
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
    auth.admin.rpc("get_payment_runtime_mode_for_service"),
  ]);
  if (pastResult.error) {
    return commerceJson({ error: "past_products_unavailable" }, 503);
  }
  if (closedResult.error) {
    return commerceJson({ error: "closed_auctions_unavailable" }, 503);
  }
  if (paymentModeResult.error) {
    return commerceJson({ error: "payment_mode_unavailable" }, 503);
  }
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
    closedAuctions: (closedResult.data ?? []).map((product) => ({
      ...product,
      image_urls: product.image_urls.map((image) =>
        getCatalogImageUrl(image, 320),
      ),
      thumbnail_urls: product.thumbnail_urls.map((image) =>
        getCatalogImageUrl(image, 320),
      ),
    })),
    canProcessSecondChance:
      auth.roleCode === "owner" || auth.roleCode === "operator",
    paymentMode:
      paymentModeResult.data === "manual_transfer"
        ? "manual_transfer"
        : paymentModeResult.data === "portone"
          ? "portone"
          : null,
  });
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
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
