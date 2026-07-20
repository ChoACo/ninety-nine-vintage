import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";
import type { Database, Json } from "@/lib/supabase/database.types";

type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function images(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.startsWith("http")).slice(0, 12)
    : [];
}

function normalizeProduct(body: Record<string, unknown>, userId: string): ProductInsert | null {
  const title = text(body.title);
  const description = text(body.description);
  const storeId = text(body.storeId);
  const saleType = body.saleType === "fixed" ? "fixed" : "auction";
  const imageUrls = images(body.imageUrls);
  const startingPrice = Number(body.startingPrice ?? body.price);
  const fixedPrice = saleType === "fixed" ? Number(body.fixedPrice ?? startingPrice) : null;
  if (
    !title ||
    !description ||
    !storeId ||
    imageUrls.length === 0 ||
    !Number.isSafeInteger(startingPrice) ||
    startingPrice <= 0 ||
    (fixedPrice !== null && (!Number.isSafeInteger(fixedPrice) || fixedPrice <= 0))
  ) return null;

  const price = saleType === "fixed" ? fixedPrice as number : startingPrice;
  const publishAt = text(body.publishAt, new Date().toISOString());
  const closesAt = text(body.closesAt, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
  return {
    title,
    description,
    category: text(body.category, "구제 의류"),
    store_id: storeId,
    sale_type: saleType,
    fixed_price: fixedPrice,
    starting_price: price,
    current_price: price,
    bid_increment: Number(body.bidIncrement) > 0 ? Number(body.bidIncrement) : 1000,
    image_urls: imageUrls,
    thumbnail_urls: imageUrls,
    publish_at: publishAt,
    closes_at: closesAt,
    status: "pending",
    created_by: userId,
    updated_by: userId,
    size_label: text(body.sizeLabel),
    condition_grade: ["S", "A+", "A", "B"].includes(text(body.conditionGrade)) ? text(body.conditionGrade) : "A",
    storage_class: text(body.storageClass) === "large" ? "large" : "small",
    measurements: body.measurements && typeof body.measurements === "object" ? body.measurements as Json : {},
    inspection_notes: Array.isArray(body.inspectionNotes)
      ? body.inspectionNotes.filter((item): item is string => typeof item === "string").slice(0, 30)
      : [],
  };
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
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
  let storeQuery = auth.admin.from("stores").select("id, operator_id").in("id", storeIds);
  if (auth.roleCode !== "owner") storeQuery = storeQuery.eq("operator_id", auth.userId);
  const { data: stores, error: storeError } = await storeQuery;
  if (storeError || (stores ?? []).length !== storeIds.length) return commerceJson({ error: "상품의 숍 권한을 확인해 주세요." }, 403);

  const { data, error } = await auth.admin
    .from("products")
    .insert(rows as ProductInsert[])
    .select("id, title, sale_type, status, store_id");
  if (error) return commerceJson({ error: error.message || "상품 일괄등록에 실패했습니다." }, 409);
  return commerceJson({ products: data ?? [], count: data?.length ?? 0 }, 201);
}
