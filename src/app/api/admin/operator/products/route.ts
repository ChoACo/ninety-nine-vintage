import type { SupabaseClient } from "@supabase/supabase-js";

import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";
import { normalizeProductBrand } from "@/lib/catalog/brand";
import {
  getNextAuctionDeadline,
  getRelativeKoreanDateTime,
} from "@/utils/formatters";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FIXED_PRODUCT_OPEN_UNTIL = "9999-12-31T23:59:59.000Z";

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function images(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 15) return [];
  const normalized = value.flatMap((candidate) => {
    if (typeof candidate !== "string") return [];
    const image = candidate.trim();
    try {
      const url = new URL(image);
      return (url.protocol === "http:" || url.protocol === "https:")
        && !url.pathname.includes("/storage/v1/render/image/public/")
        ? [image]
        : [];
    } catch {
      return [];
    }
  });
  return normalized.length === value.length ? normalized : [];
}

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner" && auth.roleCode !== "operator") {
    return commerceJson({ error: "operator_products_forbidden" }, 403);
  }
  const admin = auth.admin as unknown as SupabaseClient;
  const membershipPermissions = new Map<string, { canManage: boolean; canPublish: boolean }>();
  if (auth.roleCode !== "owner") {
    const membershipResult = await admin
      .from("store_memberships")
      .select("store_id, manage_products, publish_products")
      .eq("user_id", auth.userId)
      .eq("status", "active");
    if (membershipResult.error) {
      return commerceJson({ error: "operator_products_unavailable" }, 503);
    }
    const memberships = membershipResult.data;
    for (const membership of memberships ?? []) {
      membershipPermissions.set(membership.store_id, {
        canManage: membership.manage_products,
        canPublish: membership.publish_products,
      });
    }
  }

  const manageableStoreIds = [...membershipPermissions]
    .filter(([, permission]) => permission.canManage)
    .map(([storeId]) => storeId);
  let storeQuery = admin
    .from("stores")
    .select("id, name, slug, operator_id, is_active")
    .eq("is_active", true);
  if (auth.roleCode !== "owner") {
    if (manageableStoreIds.length === 0) {
      return commerceJson({
        stores: [],
        products: [],
        permissions: {
          canCloseAuctions: false,
          canCreate: false,
          canMutate: false,
          canPublish: false,
        },
      });
    }
    storeQuery = storeQuery.in("id", manageableStoreIds);
  }
  const { data: storeRows, error: storeError } = await storeQuery.order("name");
  if (storeError) return commerceJson({ error: "operator_products_unavailable" }, 503);
  const stores = (storeRows ?? []).map((store) => ({
    ...store,
    canPublish: auth.roleCode === "owner" || membershipPermissions.get(store.id)?.canPublish === true,
  }));
  const storeIds = (stores ?? []).map((store) => store.id);
  const { data: products, error: productError } = storeIds.length === 0
    ? { data: [], error: null }
    : await admin.from("products").select("*, stores(id, name, slug)").in("store_id", storeIds).order("created_at", { ascending: false });
  if (productError) return commerceJson({ error: "operator_products_unavailable" }, 503);
  const canMutate = stores.length > 0;
  return commerceJson({
    stores: stores ?? [],
    products: products ?? [],
    permissions: {
      canCloseAuctions: auth.roleCode === "owner",
      canCreate: stores.length > 0,
      canMutate,
      canPublish: stores.some((store) => store.canPublish),
    },
  });
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner" && auth.roleCode !== "operator") {
    return commerceJson({ error: "operator_products_forbidden" }, 403);
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const singleRegistration = body?.registrationMode === "single";
  const requestedId = text(body?.id);
  const productId = singleRegistration && UUID_PATTERN.test(requestedId)
    ? requestedId
    : crypto.randomUUID();
  const title = text(body?.title);
  const description = text(body?.description);
  const category = singleRegistration
    ? "기타"
    : text(body?.category, "기타");
  const enteredBrand = text(body?.brand);
  const normalizedBrand = enteredBrand
    ? normalizeProductBrand(enteredBrand)
    : singleRegistration
      ? { brand: "", brandSlug: "" }
      : null;
  const gender = ["남성", "여성", "공용"].includes(text(body?.gender))
    ? text(body?.gender)
    : "";
  const storeId = text(body?.storeId);
  const saleType = body?.saleType === "fixed" ? "fixed" : "auction";
  const imageUrls = images(body?.imageUrls);
  const thumbnailUrls = body?.thumbnailUrls === undefined
    ? imageUrls
    : images(body.thumbnailUrls);
  const startingPrice = Number(body?.startingPrice);
  const fixedPrice = saleType === "fixed" ? Number(body?.fixedPrice ?? body?.startingPrice) : null;
  const publicationMode = body?.publicationMode === "now"
    ? "now"
    : "next-day-10";
  const publishAt = singleRegistration
    ? publicationMode === "now"
      ? new Date().toISOString()
      : new Date(
          getRelativeKoreanDateTime(1, "10:00:00", new Date()),
        ).toISOString()
    : text(body?.publishAt, new Date().toISOString());
  const closesAt = singleRegistration
    ? saleType === "fixed"
      ? FIXED_PRODUCT_OPEN_UNTIL
      : getNextAuctionDeadline(publishAt).toISOString()
    : text(body?.closesAt, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
  if (title.length > 160 || !description || !normalizedBrand || !storeId || imageUrls.length === 0 || thumbnailUrls.length !== imageUrls.length || !Number.isSafeInteger(startingPrice) || startingPrice <= 0 || (fixedPrice !== null && (!Number.isSafeInteger(fixedPrice) || fixedPrice <= 0))) {
    return commerceJson({ error: "상품 입력값을 확인해 주세요." }, 400);
  }
  const { data: canManageStore, error: permissionError } = await auth.user.rpc(
    "has_store_permission",
    { p_store_id: storeId, p_permission: "manage_products" },
  );
  if (permissionError) return commerceJson({ error: "store_unavailable" }, 503);
  if (canManageStore !== true) return commerceJson({ error: "forbidden" }, 403);
  if (singleRegistration) {
    const { data: canPublishStore, error: publishPermissionError } =
      await auth.user.rpc("has_store_permission", {
        p_store_id: storeId,
        p_permission: "publish_products",
      });
    if (publishPermissionError) {
      return commerceJson({ error: "store_unavailable" }, 503);
    }
    if (canPublishStore !== true) {
      return commerceJson(
        {
          error: "publish_permission_required",
          message: "단품의 공개 시각을 예약하려면 상품 공개 권한이 필요합니다.",
        },
        403,
      );
    }
  }
  const price = saleType === "fixed" ? fixedPrice as number : startingPrice;
  const { data: product, error } = await auth.user.from("products").insert({
    id: productId,
    title,
    description,
    category,
    gender,
    brand: normalizedBrand.brand,
    brand_slug: normalizedBrand.brandSlug,
    brand_source: "explicit",
    store_id: storeId,
    sale_type: saleType,
    fixed_price: fixedPrice,
    starting_price: price,
    current_price: price,
    bid_increment: Number(body?.bidIncrement) > 0 ? Number(body?.bidIncrement) : 1000,
    image_urls: imageUrls,
    thumbnail_urls: thumbnailUrls,
    publish_at: publishAt,
    closes_at: closesAt,
    status: "pending",
    created_by: auth.userId,
    updated_by: auth.userId,
    size_label: singleRegistration ? "" : text(body?.sizeLabel),
    condition_grade: singleRegistration
      ? ["S", "A+", "A", "B"].includes(text(body?.conditionGrade))
        ? text(body?.conditionGrade)
        : ""
      : ["S", "A+", "A", "B"].includes(text(body?.conditionGrade))
        ? text(body?.conditionGrade)
        : "A",
    storage_class: text(body?.storageClass) === "large" ? "large" : "small",
    inspection_notes: singleRegistration
      ? []
      : Array.isArray(body?.inspectionNotes)
        ? body.inspectionNotes.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
  }).select("*").single();
  if (error) return commerceJson({ error: error.message || "상품을 등록하지 못했습니다." }, 409);
  return commerceJson({ product }, 201);
}
