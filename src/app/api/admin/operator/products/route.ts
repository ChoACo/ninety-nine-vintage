import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";
import type { Json } from "@/lib/supabase/database.types";
import { getCatalogImageUrl } from "@/lib/images";
import { normalizeProductBrand } from "@/lib/catalog/brand";

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  let storeQuery = auth.admin.from("stores").select("id, name, slug, operator_id, is_active").eq("is_active", true);
  if (auth.roleCode !== "owner") storeQuery = storeQuery.eq("operator_id", auth.userId);
  const { data: stores, error: storeError } = await storeQuery.order("name");
  if (storeError) return commerceJson({ error: "operator_products_unavailable" }, 503);
  const storeIds = (stores ?? []).map((store) => store.id);
  const { data: products, error: productError } = storeIds.length === 0
    ? { data: [], error: null }
    : await auth.admin.from("products").select("*, stores(id, name, slug)").in("store_id", storeIds).order("created_at", { ascending: false });
  if (productError) return commerceJson({ error: "operator_products_unavailable" }, 503);
  return commerceJson({ stores: stores ?? [], products: (products ?? []).map((product) => ({ ...product, image_urls: product.image_urls.map((image) => getCatalogImageUrl(image, 320)), thumbnail_urls: product.thumbnail_urls.map((image) => getCatalogImageUrl(image, 320)) })) });
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
  const imageUrls = Array.isArray(body?.imageUrls) ? body?.imageUrls.filter((value): value is string => typeof value === "string" && value.startsWith("http")) : [];
  const startingPrice = Number(body?.startingPrice);
  const fixedPrice = saleType === "fixed" ? Number(body?.fixedPrice ?? body?.startingPrice) : null;
  const publishAt = text(body?.publishAt, new Date().toISOString());
  const closesAt = text(body?.closesAt, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
  if (!title || !description || !normalizedBrand || !storeId || imageUrls.length === 0 || !Number.isSafeInteger(startingPrice) || startingPrice <= 0 || (fixedPrice !== null && (!Number.isSafeInteger(fixedPrice) || fixedPrice <= 0))) {
    return commerceJson({ error: "상품 입력값을 확인해 주세요." }, 400);
  }
  const storeQuery = auth.admin.from("stores").select("id, operator_id").eq("id", storeId);
  const { data: store, error: storeError } = await storeQuery.maybeSingle();
  if (storeError) return commerceJson({ error: "store_unavailable" }, 503);
  if (!store || (auth.roleCode !== "owner" && store.operator_id !== auth.userId)) return commerceJson({ error: "forbidden" }, 403);
  const price = saleType === "fixed" ? fixedPrice as number : startingPrice;
  const { data: product, error } = await auth.admin.from("products").insert({
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
    thumbnail_urls: imageUrls,
    publish_at: publishAt,
    closes_at: closesAt,
    status: "pending",
    created_by: auth.userId,
    updated_by: auth.userId,
    size_label: text(body?.sizeLabel),
    condition_grade: ["S", "A+", "A", "B"].includes(text(body?.conditionGrade)) ? text(body?.conditionGrade) : "A",
    storage_class: text(body?.storageClass) === "large" ? "large" : "small",
    measurements: body?.measurements && typeof body.measurements === "object" ? body.measurements as Json : {},
    inspection_notes: Array.isArray(body?.inspectionNotes) ? body.inspectionNotes.filter((value): value is string => typeof value === "string") : [],
  }).select("*").single();
  if (error) return commerceJson({ error: error.message || "상품을 등록하지 못했습니다." }, 409);
  return commerceJson({ product }, 201);
}
