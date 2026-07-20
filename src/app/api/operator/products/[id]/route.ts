import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";
import type { Database } from "@/lib/supabase/database.types";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const { data: product, error: lookupError } = await auth.admin.from("products").select("id, store_id, updated_at, status, sale_type, current_price, fixed_price").eq("id", id).maybeSingle();
  if (lookupError) return commerceJson({ error: "product_unavailable" }, 503);
  if (!product) return commerceJson({ error: "product_not_found" }, 404);
  const { data: store } = product.store_id ? await auth.admin.from("stores").select("operator_id").eq("id", product.store_id).maybeSingle() : { data: null };
  if (auth.roleCode !== "owner" && store?.operator_id !== auth.userId) return commerceJson({ error: "forbidden" }, 403);
  const updates: Database["public"]["Tables"]["products"]["Update"] = { updated_by: auth.userId };
  const writable = updates as Record<string, unknown>;
  for (const key of ["title", "description", "category", "size_label", "storage_class", "condition_grade", "publish_at", "closes_at"]) {
    if (typeof body?.[key] === "string") writable[key] = body[key];
  }
  if (Array.isArray(body?.imageUrls)) updates.image_urls = body.imageUrls.filter((value): value is string => typeof value === "string" && value.startsWith("http"));
  if (["pending", "active", "closed"].includes(String(body?.status))) updates.status = body?.status as string;
  if (product.status === "pending" && ["auction", "fixed"].includes(String(body?.saleType))) {
    const saleType = body?.saleType as "auction" | "fixed";
    const price = Number(body?.price);
    if (Number.isSafeInteger(price) && price > 0) {
      updates.sale_type = saleType;
      updates.starting_price = price;
      updates.current_price = price;
      updates.fixed_price = saleType === "fixed" ? price : null;
    }
  }
  if (Array.isArray(body?.inspectionNotes)) updates.inspection_notes = body.inspectionNotes.filter((value): value is string => typeof value === "string");
  if (body?.measurements && typeof body.measurements === "object") updates.measurements = body.measurements as Database["public"]["Tables"]["products"]["Update"]["measurements"];
  const { data: updated, error } = await auth.admin.from("products").update(updates).eq("id", id).eq("updated_at", product.updated_at).select("*").maybeSingle();
  if (error) return commerceJson({ error: error.message || "상품을 수정하지 못했습니다." }, 409);
  if (!updated) return commerceJson({ error: "stale_product" }, 409);
  return commerceJson({ product: updated });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { data: product } = await auth.admin.from("products").select("id, store_id, updated_at").eq("id", id).maybeSingle();
  if (!product) return commerceJson({ error: "product_not_found" }, 404);
  const { data: store } = product.store_id ? await auth.admin.from("stores").select("operator_id").eq("id", product.store_id).maybeSingle() : { data: null };
  if (auth.roleCode !== "owner" && store?.operator_id !== auth.userId) return commerceJson({ error: "forbidden" }, 403);
  const { error } = await auth.user.rpc("delete_managed_product", { p_product_id: id, p_expected_updated_at: product.updated_at });
  if (error) return commerceJson({ error: error.message || "상품을 삭제하지 못했습니다." }, 409);
  return commerceJson({ deleted: true });
}
