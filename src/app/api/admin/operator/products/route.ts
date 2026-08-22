import {
  authenticateOperatorStoreRequest,
  commerceJson,
} from "@/lib/commerce/server";
import { normalizeProductBrand } from "@/lib/catalog/brand";
import { getNextAuctionDeadline } from "@/utils/formatters";
import { isConditionGrade } from "@/lib/catalog/conditions";
import { normalizeDefectTags } from "@/lib/catalog/defects";
import { normalizeMeasurements } from "@/lib/catalog/measurements";
import {
  getAvailablePublishSlots,
  parseBrandAndSizeFromTitle,
} from "@/lib/utils/productParser";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FIXED_PRODUCT_OPEN_UNTIL = "9999-12-31T23:59:59.000Z";

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function images(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 15)
    return [];
  const normalized = value.flatMap((candidate) => {
    if (typeof candidate !== "string") return [];
    const image = candidate.trim();
    try {
      const url = new URL(image);
      return (url.protocol === "http:" || url.protocol === "https:") &&
        !url.pathname.includes("/storage/v1/render/image/public/")
        ? [image]
        : [];
    } catch {
      return [];
    }
  });
  return normalized.length === value.length ? normalized : [];
}

export async function GET(request: Request) {
  const auth = await authenticateOperatorStoreRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner" && auth.roleCode !== "operator") {
    return commerceJson({ error: "operator_products_forbidden" }, 403);
  }
  const user = auth.user;
  const membershipPermissions = new Map<
    string,
    { canManage: boolean; canPublish: boolean }
  >();
  if (auth.roleCode !== "owner") {
    const membershipResult = await user
      .from("store_memberships")
      .select("store_id, manage_products, publish_products")
      .eq("user_id", auth.userId)
      .eq("status", "active")
      .eq("store_id", auth.selectedStoreId);
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
  let storeQuery = user
    .from("stores")
    .select("id, name, slug")
    .eq("id", auth.selectedStoreId);
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
  if (storeError)
    return commerceJson({ error: "operator_products_unavailable" }, 503);
  const stores = await Promise.all(
    (storeRows ?? []).map(async (store) => {
      const { data } = await (
        user as unknown as {
          rpc: (
            name: string,
            args: Record<string, unknown>,
          ) => Promise<{ data: unknown }>;
        }
      ).rpc("get_store_daily_entitlements", { p_store_id: store.id });
      return {
        ...store,
        canPublish:
          auth.roleCode === "owner" ||
          membershipPermissions.get(store.id)?.canPublish === true,
        entitlements: data && typeof data === "object" ? data : null,
      };
    }),
  );
  const storeIds = (stores ?? []).map((store) => store.id);
  const { data: products, error: productError } =
    storeIds.length === 0
      ? { data: [], error: null }
      : await user
          .from("products")
          .select("*, stores(id, name, slug)")
          .in("store_id", storeIds)
          .order("created_at", { ascending: false });
  if (productError)
    return commerceJson({ error: "operator_products_unavailable" }, 503);
  const { data: lockData, error: lockError } =
    storeIds.length === 0
      ? { data: [], error: null }
      : await user.rpc("get_operator_pending_product_locks", {
          p_store_ids: storeIds,
        });
  if (lockError)
    return commerceJson({ error: "operator_products_unavailable" }, 503);
  const lockRows = (Array.isArray(lockData) ? lockData : []) as Array<{
    productId: string;
    lockKind: "buy_now_payment" | "auction_payment";
    lockUntil: string | null;
  }>;
  const locksByProduct = new Map(
    lockRows.map((lock) => [lock.productId, lock]),
  );
  const canMutate = stores.length > 0;
  return commerceJson({
    stores: stores ?? [],
    products: (products ?? []).map((product) => {
      const lock = locksByProduct.get(product.id);
      return lock
        ? {
            ...product,
            pending_lock_kind: lock.lockKind,
            pending_lock_until: lock.lockUntil,
          }
        : product;
    }),
    permissions: {
      canCloseAuctions: auth.roleCode === "owner",
      canCreate: stores.length > 0,
      canMutate,
      canPublish: stores.some((store) => store.canPublish),
    },
  });
}

export async function POST(request: Request) {
  const auth = await authenticateOperatorStoreRequest(request, true);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner" && auth.roleCode !== "operator") {
    return commerceJson({ error: "operator_products_forbidden" }, 403);
  }
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const singleRegistration = body?.registrationMode === "single";
  const requestedId = text(body?.id);
  const productId =
    singleRegistration && UUID_PATTERN.test(requestedId)
      ? requestedId
      : crypto.randomUUID();
  const title = text(body?.title);
  const description = text(body?.description);
  const category = text(body?.category, "기타");
  const categoryId = /^\d{6,9}$/u.test(text(body?.categoryId))
    ? text(body?.categoryId)
    : null;
  const parsedTitle = parseBrandAndSizeFromTitle(title);
  const enteredBrand = singleRegistration
    ? (parsedTitle.brand ?? "")
    : text(body?.brand);
  const normalizedBrand = enteredBrand
    ? normalizeProductBrand(enteredBrand)
    : singleRegistration
      ? normalizeProductBrand("기타")
      : null;
  const gender = ["남성", "여성", "공용"].includes(text(body?.gender))
    ? text(body?.gender)
    : "";
  const storeId = auth.selectedStoreId;
  const saleType = body?.saleType === "fixed" ? "fixed" : "auction";
  const imageUrls = images(body?.imageUrls);
  const thumbnailUrls =
    body?.thumbnailUrls === undefined ? imageUrls : images(body.thumbnailUrls);
  const startingPrice = Number(body?.startingPrice);
  const fixedPrice =
    saleType === "fixed"
      ? Number(body?.fixedPrice ?? body?.startingPrice)
      : null;
  const requestedPublicationMode =
    body?.publicationMode === "now" ? "now" : "scheduled";
  const publicationMode = requestedPublicationMode;
  const scheduledHourKst = Number.isInteger(Number(body?.scheduledHourKst))
    ? Number(body?.scheduledHourKst)
    : 10;
  const requestedPublishAt = text(body?.publishAt);
  const normalizedRequestedPublishAt =
    requestedPublishAt && Number.isFinite(Date.parse(requestedPublishAt))
      ? new Date(requestedPublishAt).toISOString()
      : null;
  const availablePublishSlots = new Set(
    getAvailablePublishSlots().map((slot) => slot.value),
  );
  const validRequestedPublishAt =
    normalizedRequestedPublishAt &&
    availablePublishSlots.has(normalizedRequestedPublishAt)
      ? normalizedRequestedPublishAt
      : null;
  if (
    singleRegistration &&
    publicationMode === "scheduled" &&
    requestedPublishAt &&
    !validRequestedPublishAt
  ) {
    return commerceJson({ error: "공개 시각을 다시 선택해 주세요." }, 400);
  }
  const publishAt = singleRegistration
    ? publicationMode === "now"
      ? new Date().toISOString()
      : (validRequestedPublishAt ?? getAvailablePublishSlots()[0].value)
    : text(body?.publishAt, new Date().toISOString());
  const closesAt = singleRegistration
    ? saleType === "fixed"
      ? FIXED_PRODUCT_OPEN_UNTIL
      : getNextAuctionDeadline(publishAt).toISOString()
    : text(
        body?.closesAt,
        new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      );
  if (
    !title ||
    title.length > 160 ||
    (!singleRegistration && !description) ||
    description.length > 10000 ||
    !normalizedBrand ||
    !storeId ||
    storeId !== auth.selectedStoreId ||
    imageUrls.length === 0 ||
    thumbnailUrls.length !== imageUrls.length ||
    !Number.isSafeInteger(startingPrice) ||
    startingPrice <= 0 ||
    scheduledHourKst < 0 ||
    scheduledHourKst > 23 ||
    (fixedPrice !== null &&
      (!Number.isSafeInteger(fixedPrice) || fixedPrice <= 0))
  ) {
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
  const price = saleType === "fixed" ? (fixedPrice as number) : startingPrice;
  // enhanced_title/hashtags columns are added by migration 20260804020000
  const aiMetadata = {
    enhanced_title:
      typeof body?.enhancedTitle === "string" &&
      body.enhancedTitle.length <= 160
        ? body.enhancedTitle.trim()
        : null,
    hashtags:
      Array.isArray(body?.hashtags) && body.hashtags.length <= 8
        ? body.hashtags
            .filter((v): v is string => typeof v === "string")
            .slice(0, 8)
        : [],
  };
  const { data: product, error } = await auth.user
    .from("products")
    .insert({
      id: productId,
      title,
      description,
      category,
      category_id: categoryId,
      gender,
      brand: normalizedBrand.brand,
      brand_slug: normalizedBrand.brandSlug,
      brand_source: parsedTitle.brand ? "explicit" : "inferred",
      store_id: storeId,
      sale_type: saleType,
      fixed_price: fixedPrice,
      starting_price: price,
      current_price: price,
      bid_increment:
        Number(body?.bidIncrement) > 0 ? Number(body?.bidIncrement) : 1000,
      image_urls: imageUrls,
      thumbnail_urls: thumbnailUrls,
      publish_at: publishAt,
      closes_at: closesAt,
      status: "pending",
      created_by: auth.userId,
      updated_by: auth.userId,
      size_label: singleRegistration
        ? (parsedTitle.size ?? "")
        : text(body?.sizeLabel),
      condition_grade: singleRegistration
        ? "A"
        : isConditionGrade(text(body?.conditionGrade))
          ? text(body?.conditionGrade)
          : "A",
      storage_class: text(body?.storageClass) === "large" ? "large" : "small",
      inspection_notes: Array.isArray(body?.inspectionNotes)
        ? body.inspectionNotes
            .filter(
              (value): value is string =>
                typeof value === "string" && value.length <= 500,
            )
            .slice(0, 50)
        : [],
      defect_tags: normalizeDefectTags(body?.defectTags),
      measurements: normalizeMeasurements(body?.measurements),
      ...(aiMetadata as Record<string, unknown>),
    })
    .select("*")
    .single();
  if (error)
    return commerceJson(
      { error: error.message || "상품을 등록하지 못했습니다." },
      409,
    );
  return commerceJson({ product }, 201);
}
