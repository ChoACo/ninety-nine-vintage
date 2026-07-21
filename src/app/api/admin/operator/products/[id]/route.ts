import { normalizeProductBrand } from "@/lib/catalog/brand";
import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";
import type { Json } from "@/lib/supabase/database.types";

const MAX_PRODUCT_PRICE = 1_000_000_000;
const MAX_BID_INCREMENT = 100_000_000;
const PRODUCT_CONDITIONS = new Set(["S", "A+", "A", "B"]);
const PRODUCT_IMAGES_BUCKET = "product-images";

function hasOwn(body: Record<string, unknown>, key: string) {
  return Object.hasOwn(body, key);
}

function requiredText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximumLength ? normalized : null;
}

function optionalText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length <= maximumLength ? normalized : null;
}

function validInteger(value: unknown, maximum: number): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : null;
}

function validIsoDateTime(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function validTimestampVersion(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim();
  return Number.isNaN(new Date(normalized).getTime()) ? null : normalized;
}

function normalizeImageUrls(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) return null;
  const urls = value.flatMap((candidate) => {
    if (typeof candidate !== "string") return [];
    const normalized = candidate.trim();
    try {
      const url = new URL(normalized);
      return (url.protocol === "http:" || url.protocol === "https:")
        && !url.pathname.includes("/storage/v1/render/image/public/")
        ? [normalized]
        : [];
    } catch {
      return [];
    }
  });
  return urls.length > 0 && urls.length === value.length ? urls : null;
}

function normalizeMeasurements(value: unknown): Json | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const result: Record<string, number> = {};
  for (const key of ["shoulder", "chest", "sleeve", "length"]) {
    if (!hasOwn(source, key)) continue;
    const measurement = Number(source[key]);
    if (!Number.isFinite(measurement) || measurement <= 0) return null;
    result[key] = measurement;
  }
  return result;
}

function sameUrls(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function mutationErrorStatus(error: { code?: string | null }) {
  if (error.code === "42501") return 403;
  if (error.code === "P0002") return 404;
  if (error.code === "22023" || error.code === "22P02") return 400;
  return 409;
}

function storagePathFromProductImageUrl(publicUrl: string, productId: string): string | null {
  try {
    const configuredUrl = process.env.SUPABASE_URL?.trim()
      || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    if (!configuredUrl) return null;
    const marker = `/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/`;
    const parsedUrl = new URL(publicUrl);
    if (parsedUrl.origin !== new URL(configuredUrl).origin) return null;
    const pathname = parsedUrl.pathname;
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const path = decodeURIComponent(pathname.slice(markerIndex + marker.length));
    const segments = path.split("/");
    return segments[0] === "products"
      && segments[1] === productId
      && segments.length >= 4
      && (segments[2] === "images" || segments[2] === "thumbnails")
      && segments.every((segment) => segment !== "." && segment !== "..")
      ? path
      : null;
  } catch {
    return null;
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return commerceJson({ error: "invalid_request" }, 400);

  const expectedUpdatedAt = validTimestampVersion(body.expectedUpdatedAt);
  if (!expectedUpdatedAt) return commerceJson({ error: "expected_updated_at_required" }, 400);

  const { data: product, error: lookupError } = await auth.user
    .from("products")
    .select("id, store_id, updated_at, status, sale_type, starting_price, fixed_price, bid_increment, participant_count, final_bid_id, title, description, category, brand, image_urls, thumbnail_urls, size_label, condition_grade, storage_class, publish_at, inspection_notes, measurements")
    .eq("id", id)
    .maybeSingle();
  if (lookupError) return commerceJson({ error: "product_unavailable" }, 503);
  if (!product) return commerceJson({ error: "product_not_found" }, 404);
  if (new Date(product.updated_at).getTime() !== new Date(expectedUpdatedAt).getTime()) {
    return commerceJson({ error: "stale_product" }, 409);
  }

  if (hasOwn(body, "status")) {
    if (body.status !== "pending" && body.status !== "active" && body.status !== "closed") {
      return commerceJson({ error: "invalid_product_status" }, 400);
    }
    if (body.status !== product.status) {
      return commerceJson({
        error: product.status === "pending" && body.status === "active"
          ? "publish_endpoint_required"
          : "invalid_status_transition",
      }, 409);
    }
  }
  if (product.status === "closed") return commerceJson({ error: "closed_product_immutable" }, 409);
  if (product.status !== "pending") return commerceJson({ error: "pending_product_required" }, 409);
  if (product.participant_count > 0 || product.final_bid_id) {
    return commerceJson({ error: "product_has_bid_history" }, 409);
  }

  const title = hasOwn(body, "title") ? requiredText(body.title, 160) : product.title;
  if (!title) return commerceJson({ error: "상품명을 확인해 주세요." }, 400);
  const description = hasOwn(body, "description") ? requiredText(body.description, 10_000) : product.description;
  if (!description) return commerceJson({ error: "상품 설명을 확인해 주세요." }, 400);
  const category = hasOwn(body, "category") ? requiredText(body.category, 80) : product.category;
  if (!category) return commerceJson({ error: "카테고리를 확인해 주세요." }, 400);
  const normalizedBrand = hasOwn(body, "brand")
    ? normalizeProductBrand(body.brand)
    : normalizeProductBrand(product.brand);
  if (!normalizedBrand) return commerceJson({ error: "브랜드를 입력해 주세요." }, 400);

  const storeId = hasOwn(body, "storeId") ? requiredText(body.storeId, 64) : product.store_id;
  if (!storeId) return commerceJson({ error: "스토어를 선택해 주세요." }, 400);
  const saleType = hasOwn(body, "saleType") ? body.saleType : product.sale_type;
  if (saleType !== "auction" && saleType !== "fixed") {
    return commerceJson({ error: "판매 방식을 확인해 주세요." }, 400);
  }
  const startingPrice = hasOwn(body, "startingPrice")
    ? validInteger(body.startingPrice, MAX_PRODUCT_PRICE)
    : product.starting_price;
  if (!startingPrice) return commerceJson({ error: "가격을 확인해 주세요." }, 400);
  if (hasOwn(body, "fixedPrice")) {
    const fixedPrice = body.fixedPrice === null || body.fixedPrice === undefined
      ? null
      : validInteger(body.fixedPrice, MAX_PRODUCT_PRICE);
    if ((saleType === "fixed" && fixedPrice !== startingPrice) || (saleType === "auction" && fixedPrice !== null)) {
      return commerceJson({ error: "판매 방식과 가격이 일치하지 않습니다." }, 400);
    }
  }
  const bidIncrement = hasOwn(body, "bidIncrement")
    ? validInteger(body.bidIncrement, MAX_BID_INCREMENT)
    : product.bid_increment;
  if (!bidIncrement) return commerceJson({ error: "입찰 단위를 확인해 주세요." }, 400);

  const sizeLabel = hasOwn(body, "sizeLabel") ? optionalText(body.sizeLabel, 80) : product.size_label;
  if (sizeLabel === null) return commerceJson({ error: "사이즈를 확인해 주세요." }, 400);
  const conditionGrade = hasOwn(body, "conditionGrade") ? body.conditionGrade : product.condition_grade;
  if (typeof conditionGrade !== "string" || !PRODUCT_CONDITIONS.has(conditionGrade)) {
    return commerceJson({ error: "컨디션 등급을 확인해 주세요." }, 400);
  }
  const storageClass = hasOwn(body, "storageClass") ? body.storageClass : product.storage_class;
  if (storageClass !== "small" && storageClass !== "large") {
    return commerceJson({ error: "보관 등급을 확인해 주세요." }, 400);
  }
  const publishAt = hasOwn(body, "publishAt") ? validIsoDateTime(body.publishAt) : product.publish_at;
  if (!publishAt) return commerceJson({ error: "공개 시각을 확인해 주세요." }, 400);
  if (hasOwn(body, "closesAt") && !validIsoDateTime(body.closesAt)) {
    return commerceJson({ error: "마감 시각을 확인해 주세요." }, 400);
  }

  const imageUrls = hasOwn(body, "imageUrls") ? normalizeImageUrls(body.imageUrls) : product.image_urls;
  if (!imageUrls) return commerceJson({ error: "상품 이미지 URL을 확인해 주세요." }, 400);
  const thumbnailUrls = sameUrls(imageUrls, product.image_urls)
    ? product.thumbnail_urls.length > 0 ? product.thumbnail_urls : product.image_urls
    : imageUrls;
  let inspectionNotes = product.inspection_notes;
  if (hasOwn(body, "inspectionNotes")) {
    if (!Array.isArray(body.inspectionNotes) || !body.inspectionNotes.every((value) => typeof value === "string")) {
      return commerceJson({ error: "검수 메모를 확인해 주세요." }, 400);
    }
    inspectionNotes = body.inspectionNotes.map((value) => value.trim()).filter(Boolean);
  }
  const measurements = hasOwn(body, "measurements")
    ? normalizeMeasurements(body.measurements)
    : product.measurements;
  if (!measurements || typeof measurements !== "object" || Array.isArray(measurements)) {
    return commerceJson({ error: "실측값을 확인해 주세요." }, 400);
  }

  const { data: updated, error } = await auth.user
    .rpc("update_operator_product", {
      p_product_id: id,
      p_expected_updated_at: expectedUpdatedAt,
      p_title: title,
      p_description: description,
      p_category: category,
      p_brand: normalizedBrand.brand,
      p_store_id: storeId,
      p_sale_type: saleType,
      p_starting_price: startingPrice,
      p_bid_increment: bidIncrement,
      p_publish_at: publishAt,
      p_image_urls: imageUrls,
      p_thumbnail_urls: thumbnailUrls,
      p_size_label: sizeLabel,
      p_condition_grade: conditionGrade,
      p_storage_class: storageClass,
      p_measurements: measurements,
      p_inspection_notes: inspectionNotes,
    })
    .single();
  if (error) return commerceJson({ error: error.message || "상품을 수정하지 못했습니다." }, mutationErrorStatus(error));
  if (!updated) return commerceJson({ error: "stale_product" }, 409);
  return commerceJson({ product: updated });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const expectedUpdatedAt = validTimestampVersion(body?.expectedUpdatedAt);
  if (!expectedUpdatedAt) return commerceJson({ error: "expected_updated_at_required" }, 400);

  const { data: deletedImageUrls, error } = await auth.user.rpc("delete_managed_product", {
    p_product_id: id,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) return commerceJson({ error: error.message || "상품을 삭제하지 못했습니다." }, mutationErrorStatus(error));

  const storagePaths = [...new Set((deletedImageUrls ?? []).flatMap((imageUrl) => {
    const path = storagePathFromProductImageUrl(imageUrl, id);
    return path ? [path] : [];
  }))];
  let imageCleanupPending = false;
  if (storagePaths.length > 0) {
    try {
      const { error: cleanupError } = await auth.admin.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .remove(storagePaths);
      imageCleanupPending = Boolean(cleanupError);
    } catch {
      imageCleanupPending = true;
    }
  }

  return commerceJson({ deleted: true, imageCleanupPending });
}
