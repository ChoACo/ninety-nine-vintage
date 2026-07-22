import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";
import { normalizeProductBrand } from "@/lib/catalog/brand";

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function images(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) return [];
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
  const membershipPermissions = new Map<string, { canManage: boolean; canPublish: boolean }>();
  if (auth.roleCode !== "owner") {
    const { data: memberships, error: membershipError } = await auth.user
      .from("store_memberships")
      .select("store_id, manage_products, publish_products")
      .eq("user_id", auth.userId)
      .eq("status", "active");
    if (membershipError) return commerceJson({ error: "operator_products_unavailable" }, 503);
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
  let storeQuery = auth.user
    .from("stores")
    .select("id, name, slug, operator_id, is_active")
    .eq("is_active", true);
  if (auth.roleCode !== "owner") {
    if (manageableStoreIds.length === 0) {
      return commerceJson({ stores: [], products: [], permissions: { canCreate: false, canMutate: false, canPublish: false } });
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
    : await auth.user.from("products").select("*, stores(id, name, slug)").in("store_id", storeIds).order("created_at", { ascending: false });
  if (productError) return commerceJson({ error: "operator_products_unavailable" }, 503);
  const canMutate = stores.length > 0;
  return commerceJson({
    stores: stores ?? [],
    products: products ?? [],
    permissions: {
      canCreate: stores.length > 0,
      canMutate,
      canPublish: stores.some((store) => store.canPublish),
    },
  });
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const title = text(body?.title);
  const description = text(body?.description);
  const category = text(body?.category, "구제 의류");
  const normalizedBrand = normalizeProductBrand(body?.brand);
  const storeId = text(body?.storeId);
  const saleType = body?.saleType === "fixed" ? "fixed" : "auction";
  const imageUrls = images(body?.imageUrls);
  const thumbnailUrls = body?.thumbnailUrls === undefined
    ? imageUrls
    : images(body.thumbnailUrls);
  const startingPrice = Number(body?.startingPrice);
  const fixedPrice = saleType === "fixed" ? Number(body?.fixedPrice ?? body?.startingPrice) : null;
  const publishAt = text(body?.publishAt, new Date().toISOString());
  const closesAt = text(body?.closesAt, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
  if (!title || !description || !normalizedBrand || !storeId || imageUrls.length === 0 || thumbnailUrls.length !== imageUrls.length || !Number.isSafeInteger(startingPrice) || startingPrice <= 0 || (fixedPrice !== null && (!Number.isSafeInteger(fixedPrice) || fixedPrice <= 0))) {
    return commerceJson({ error: "상품 입력값을 확인해 주세요." }, 400);
  }
  const { data: canManageStore, error: permissionError } = await auth.user.rpc(
    "has_store_permission",
    { p_store_id: storeId, p_permission: "manage_products" },
  );
  if (permissionError) return commerceJson({ error: "store_unavailable" }, 503);
  if (canManageStore !== true) return commerceJson({ error: "forbidden" }, 403);
  const price = saleType === "fixed" ? fixedPrice as number : startingPrice;
  const { data: product, error } = await auth.user.from("products").insert({
    title,
    description,
    category,
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
    size_label: text(body?.sizeLabel),
    condition_grade: ["S", "A+", "A", "B"].includes(text(body?.conditionGrade)) ? text(body?.conditionGrade) : "A",
    storage_class: text(body?.storageClass) === "large" ? "large" : "small",
    inspection_notes: Array.isArray(body?.inspectionNotes) ? body.inspectionNotes.filter((value): value is string => typeof value === "string") : [],
  }).select("*").single();
  if (error) return commerceJson({ error: error.message || "상품을 등록하지 못했습니다." }, 409);
  return commerceJson({ product }, 201);
}
