import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";
import type { Database, Json } from "@/lib/supabase/database.types";

type ProductUpdate = Database["public"]["Tables"]["products"]["Update"];
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateStaffRequest(request, true); if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner") return commerceJson({ error: "forbidden" }, 403);
  const { id } = await params; const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return commerceJson({ error: "수정 내용을 확인해 주세요." }, 400);
  const update: ProductUpdate = { updated_by: auth.userId };
  if (typeof body.title === "string") update.title = text(body.title);
  if (typeof body.description === "string") update.description = text(body.description);
  if (typeof body.category === "string") update.category = text(body.category);
  if (typeof body.status === "string" && ["pending", "active", "closed"].includes(body.status)) update.status = body.status;
  if (typeof body.saleType === "string" && ["auction", "fixed"].includes(body.saleType)) update.sale_type = body.saleType;
  if (typeof body.price === "number" && Number.isSafeInteger(body.price) && body.price > 0) { update.current_price = body.price; update.starting_price = body.price; if (update.sale_type === "fixed" || body.saleType === "fixed") update.fixed_price = body.price; }
  if (Array.isArray(body.imageUrls)) {
    const imageUrls = body.imageUrls.filter((item): item is string => typeof item === "string" && item.startsWith("http"));
    update.image_urls = imageUrls;
    update.thumbnail_urls = imageUrls;
  }
  if (Array.isArray(body.inspectionNotes)) update.inspection_notes = body.inspectionNotes.filter((item): item is string => typeof item === "string");
  if (body.measurements && typeof body.measurements === "object") update.measurements = body.measurements as Json;
  if (typeof body.sizeLabel === "string") update.size_label = text(body.sizeLabel);
  if (body.storageClass === "small" || body.storageClass === "large") update.storage_class = body.storageClass;
  const { data, error } = await auth.admin.from("products").update(update).eq("id", id).select("*").maybeSingle();
  if (error) return commerceJson({ error: error.message || "상품을 수정하지 못했습니다." }, 409);
  if (!data) return commerceJson({ error: "상품을 찾지 못했습니다." }, 404);
  return commerceJson({ product: data });
}
