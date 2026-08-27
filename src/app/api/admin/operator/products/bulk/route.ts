import { authenticateOperatorStoreRequest, commerceJson } from "@/lib/commerce/server";
import type { Database } from "@/lib/supabase/database.types";
import { normalizeProductBrand } from "@/lib/catalog/brand";
import { isConditionGrade } from "@/lib/catalog/conditions";
import { normalizeDefectTags } from "@/lib/catalog/defects";
import { normalizeMeasurements } from "@/lib/catalog/measurements";
import { getBatchClothingCategory } from "@/lib/import/categoryIds";

type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function searchTags(value: unknown) {
  if (!Array.isArray(value) || value.length > 20) return null;
  const tags = value.flatMap((candidate) => {
    if (typeof candidate !== "string") return [];
    const tag = candidate.normalize("NFKC").replace(/^#+/u, "").trim();
    return tag && tag.length <= 50 ? [tag] : [];
  });
  return tags.length === value.length ? [...new Set(tags)] : null;
}

function normalizeProduct(body: Record<string, unknown>, userId: string): ProductInsert | null {
  const productId = text(body.id);
  const title = text(body.title);
  const description = text(body.description);
  const storeId = text(body.storeId);
  const category = getBatchClothingCategory(body.categoryId);
  const normalizedBrand = normalizeProductBrand(body.brand);
  const saleType = body.saleType === "fixed" ? "fixed" : "auction";
  const imageUrls = images(body.imageUrls);
  const thumbnailUrls = body.thumbnailUrls === undefined ? imageUrls : images(body.thumbnailUrls);
  const startingPrice = Number(body.startingPrice ?? body.price);
  const fixedPrice = saleType === "fixed" ? Number(body.fixedPrice ?? startingPrice) : null;
  const bidIncrement = Number(body.bidIncrement ?? 1000);
  const conditionGrade = text(body.conditionGrade);
  const storageClass = text(body.storageClass);
  const normalizedDefectTags = normalizeDefectTags(body.defectTags);
  const normalizedSearchTags = searchTags(body.searchTags);
  const publishAt = text(body.publishAt);
  const closesAt = text(body.closesAt);
  if (
    (productId && !UUID_PATTERN.test(productId)) ||
    title.length < 2 ||
    title.length > 160 ||
    description.length < 1 ||
    description.length > 10_000 ||
    !storeId ||
    !category ||
    text(body.category) !== category.label ||
    text(body.gender) !== category.gender ||
    Number(body.quantity) !== 1 ||
    !normalizedBrand ||
    !isConditionGrade(conditionGrade) ||
    (storageClass !== "small" && storageClass !== "large") ||
    !Array.isArray(body.defectTags) ||
    normalizedDefectTags.length !== body.defectTags.length ||
    !normalizedSearchTags ||
    imageUrls.length === 0 ||
    thumbnailUrls.length !== imageUrls.length ||
    !Number.isSafeInteger(startingPrice) ||
    startingPrice < 500 ||
    !Number.isSafeInteger(bidIncrement) ||
    bidIncrement <= 0 ||
    bidIncrement > 100_000_000 ||
    (fixedPrice !== null && (!Number.isSafeInteger(fixedPrice) || fixedPrice < 500)) ||
    !Number.isFinite(Date.parse(publishAt)) ||
    !Number.isFinite(Date.parse(closesAt))
  ) return null;

  const price = saleType === "fixed" ? fixedPrice as number : startingPrice;
  return {
    ...(productId ? { id: productId } : {}),
    title,
    description,
    category: category.label,
    category_id: category.id,
    gender: category.gender,
    brand: normalizedBrand.brand,
    brand_slug: normalizedBrand.brandSlug,
    brand_source: "explicit",
    store_id: storeId,
    sale_type: saleType,
    fixed_price: fixedPrice,
    starting_price: price,
    current_price: price,
    bid_increment: bidIncrement,
    image_urls: imageUrls,
    thumbnail_urls: thumbnailUrls,
    publish_at: publishAt,
    closes_at: closesAt,
    status: "pending",
    created_by: userId,
    updated_by: userId,
    size_label: text(body.sizeLabel),
    condition_grade: conditionGrade,
    storage_class: storageClass,
    inspection_notes: Array.isArray(body.inspectionNotes)
      ? body.inspectionNotes.filter((item): item is string => typeof item === "string").slice(0, 30)
      : [],
    defect_tags: normalizedDefectTags,
    hashtags: normalizedSearchTags,
    measurements: normalizeMeasurements(body.measurements),
  };
}

export async function POST(request: Request) {
  const auth = await authenticateOperatorStoreRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as { products?: unknown } | null;
  if (!Array.isArray(body?.products) || body.products.length === 0 || body.products.length > 200) {
    return commerceJson({ error: "1~200개의 상품을 보내 주세요." }, 400);
  }

  const rows = body.products.map((item) => item && typeof item === "object"
    ? normalizeProduct(item as Record<string, unknown>, auth.userId)
    : null);
  if (rows.some((row) => !row)) return commerceJson({ error: "일괄등록 상품 입력값을 확인해 주세요." }, 400);

  const storeIds = [...new Set(rows.map((row) => (row as ProductInsert).store_id).filter((id): id is string => typeof id === "string"))];
  if (storeIds.length !== 1 || storeIds[0] !== auth.selectedStoreId) {
    return commerceJson({ error: "operator_store_scope_mismatch" }, 403);
  }
  const permissionResults = await Promise.all(storeIds.map((storeId) => auth.user.rpc(
    "has_store_permission",
    { p_store_id: storeId, p_permission: "manage_products" },
  )));
  if (permissionResults.some((result) => result.error)) {
    return commerceJson({ error: "상품의 숍 권한을 확인하지 못했습니다." }, 503);
  }
  if (permissionResults.some((result) => result.data !== true)) {
    return commerceJson({ error: "상품의 숍 권한을 확인해 주세요." }, 403);
  }
  const publishPermissionResults = await Promise.all(storeIds.map((storeId) => auth.user.rpc(
    "has_store_permission",
    { p_store_id: storeId, p_permission: "publish_products" },
  )));
  if (publishPermissionResults.some((result) => result.error)) {
    return commerceJson({ error: "상품 공개 권한을 확인하지 못했습니다." }, 503);
  }
  if (publishPermissionResults.some((result) => result.data !== true)) {
    return commerceJson({ error: "상품 공개 권한이 필요합니다." }, 403);
  }

  const entitlementResults = await Promise.all(storeIds.map((storeId) => (
    auth.user as unknown as {
      rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    }
  ).rpc("get_store_daily_entitlements", { p_store_id: storeId })));
  if (entitlementResults.some((result) => result.error)) {
    return commerceJson({ error: "센터 일괄등록 등급을 확인하지 못했습니다." }, 503);
  }
  if (entitlementResults.some((result) => {
    const value = result.data as { bulkImportEnabled?: unknown } | null;
    return value?.bulkImportEnabled !== true;
  })) {
    return commerceJson({
      error: "bulk_import_plan_required",
      message: "일괄등록은 월 5만원 등급 센터에서만 사용할 수 있습니다.",
    }, 403);
  }

  const { data, error } = await auth.user
    .from("products")
    .insert(rows as ProductInsert[])
    .select("id, title, sale_type, status, store_id");
  if (error) return commerceJson({ error: error.message || "상품 일괄등록에 실패했습니다." }, 409);
  return commerceJson({ products: data ?? [], count: data?.length ?? 0 }, 201);
}
