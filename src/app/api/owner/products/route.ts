import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";
import type { Database, Json } from "@/lib/supabase/database.types";
import { getCatalogImageUrl } from "@/lib/images";

type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];

function text(value: unknown, fallback = "") { return typeof value === "string" ? value.trim() : fallback; }
function imageUrls(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.startsWith("http")).slice(0, 12) : []; }
function normalizeProduct(body: Record<string, unknown>, ownerId: string): ProductInsert | null {
  const title = text(body.title); const description = text(body.description); const storeId = text(body.storeId);
  const saleType = body.saleType === "fixed" ? "fixed" : "auction";
  const images = imageUrls(body.imageUrls);
  const startingPrice = Number(body.startingPrice ?? body.price); const fixedPrice = saleType === "fixed" ? Number(body.fixedPrice ?? startingPrice) : null;
  if (!title || !description || !storeId || images.length === 0 || !Number.isSafeInteger(startingPrice) || startingPrice <= 0 || (fixedPrice !== null && (!Number.isSafeInteger(fixedPrice) || fixedPrice <= 0))) return null;
  const price = saleType === "fixed" ? fixedPrice as number : startingPrice;
  const publishAt = text(body.publishAt, new Date().toISOString()); const closesAt = text(body.closesAt, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
  return {
    title, description, category: text(body.category, "구제 의류"), store_id: storeId, sale_type: saleType, fixed_price: fixedPrice,
    starting_price: price, current_price: price, bid_increment: Number(body.bidIncrement) > 0 ? Number(body.bidIncrement) : 1000,
    image_urls: images, thumbnail_urls: images, publish_at: publishAt, closes_at: closesAt, status: text(body.status, "pending"),
    created_by: ownerId, updated_by: ownerId, size_label: text(body.sizeLabel), condition_grade: ["S", "A+", "A", "B"].includes(text(body.conditionGrade)) ? text(body.conditionGrade) : "A",
    storage_class: text(body.storageClass) === "large" ? "large" : "small", measurements: body.measurements && typeof body.measurements === "object" ? body.measurements as Json : {},
    inspection_notes: Array.isArray(body.inspectionNotes) ? body.inspectionNotes.filter((item): item is string => typeof item === "string").slice(0, 30) : [],
  };
}

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request); if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") return commerceJson({ error: "forbidden" }, 403);
  const [{ data: stores, error: storeError }, { data: products, error: productError }] = await Promise.all([
    auth.admin.from("stores").select("id, name, slug, operator_id, is_active").order("name"),
    auth.admin.from("products").select("*, stores(id, name, slug)").order("created_at", { ascending: false }),
  ]);
  if (storeError || productError) return commerceJson({ error: "owner_products_unavailable" }, 503);
  return commerceJson({ stores: stores ?? [], products: (products ?? []).map((product) => ({ ...product, image_urls: product.image_urls.map((image) => getCatalogImageUrl(image, 320)), thumbnail_urls: product.thumbnail_urls.map((image) => getCatalogImageUrl(image, 320)) })) });
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true); if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") return commerceJson({ error: "forbidden" }, 403);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const product = body ? normalizeProduct(body, auth.userId) : null;
  if (!product) return commerceJson({ error: "상품 입력값을 확인해 주세요." }, 400);
  const { data: store } = await auth.admin.from("stores").select("id").eq("id", product.store_id as string).maybeSingle();
  if (!store) return commerceJson({ error: "숍을 확인해 주세요." }, 404);
  const { data, error } = await auth.admin.from("products").insert(product).select("*").single();
  if (error) return commerceJson({ error: error.message || "상품을 등록하지 못했습니다." }, 409);
  return commerceJson({ product: data }, 201);
}
