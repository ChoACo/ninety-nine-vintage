import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";
import type { Database } from "@/lib/supabase/database.types";
import { normalizeProductBrand } from "@/lib/catalog/brand";

type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];
function text(value: unknown, fallback = "") { return typeof value === "string" ? value.trim() : fallback; }
function normalize(body: Record<string, unknown>, ownerId: string): ProductInsert | null {
  const normalizedBrand = normalizeProductBrand(body.brand);
  const images = Array.isArray(body.imageUrls) ? body.imageUrls.filter((item): item is string => typeof item === "string" && item.startsWith("http")).slice(0, 12) : [];
  const saleType = body.saleType === "fixed" ? "fixed" : "auction"; const startingPrice = Number(body.startingPrice ?? body.price); const fixedPrice = saleType === "fixed" ? Number(body.fixedPrice ?? startingPrice) : null;
  if (!text(body.title) || !text(body.description) || !normalizedBrand || !text(body.storeId) || images.length === 0 || !Number.isSafeInteger(startingPrice) || startingPrice <= 0 || (fixedPrice !== null && (!Number.isSafeInteger(fixedPrice) || fixedPrice <= 0))) return null;
  const price = saleType === "fixed" ? fixedPrice as number : startingPrice;
  return { title: text(body.title), description: text(body.description), category: text(body.category, "구제 의류"), brand: normalizedBrand.brand, brand_slug: normalizedBrand.brandSlug, brand_source: "explicit", store_id: text(body.storeId), sale_type: saleType, fixed_price: fixedPrice, starting_price: price, current_price: price, bid_increment: 1000, image_urls: images, thumbnail_urls: images, publish_at: text(body.publishAt, new Date().toISOString()), closes_at: text(body.closesAt, new Date(Date.now() + 86400000).toISOString()), status: "pending", created_by: ownerId, updated_by: ownerId, size_label: text(body.sizeLabel), condition_grade: ["S", "A+", "A", "B"].includes(text(body.conditionGrade)) ? text(body.conditionGrade) : "A", storage_class: text(body.storageClass) === "large" ? "large" : "small", measurements: body.measurements && typeof body.measurements === "object" ? body.measurements as Database["public"]["Tables"]["products"]["Insert"]["measurements"] : {}, inspection_notes: Array.isArray(body.inspectionNotes) ? body.inspectionNotes.filter((item): item is string => typeof item === "string").slice(0, 30) : [] };
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true); if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") return commerceJson({ error: "forbidden" }, 403);
  const body = await request.json().catch(() => null) as { products?: unknown } | null;
  if (!Array.isArray(body?.products) || body.products.length === 0 || body.products.length > 200) return commerceJson({ error: "1~200개의 상품을 보내 주세요." }, 400);
  const rows = body.products.map((item) => item && typeof item === "object" ? normalize(item as Record<string, unknown>, auth.userId) : null);
  if (rows.some((row) => !row)) return commerceJson({ error: "일괄등록 상품 입력값을 확인해 주세요." }, 400);
  const storeIds = [...new Set(rows.map((row) => (row as ProductInsert).store_id).filter((id): id is string => typeof id === "string"))];
  const { data: stores, error: storeError } = await auth.admin.from("stores").select("id").in("id", storeIds);
  if (storeError || (stores ?? []).length !== storeIds.length) return commerceJson({ error: "상품의 숍을 확인해 주세요." }, 400);
  const { data, error } = await auth.admin.from("products").insert(rows as ProductInsert[]).select("id, title, sale_type, status");
  if (error) return commerceJson({ error: error.message || "상품 일괄등록에 실패했습니다." }, 409);
  return commerceJson({ products: data ?? [], count: data?.length ?? 0 }, 201);
}
