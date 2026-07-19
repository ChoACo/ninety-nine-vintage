import type { NewAuctionDraft } from "@/src/components/feed";
import type { BatchAuctionProgressReporter } from "@/src/lib/import/batchAuction";
import type {
  AuctionPost,
  AuctionStatus,
  BidHistoryRecord,
  ProductSaleType,
} from "@/src/types/auction";
import { getNextAuctionDeadline } from "@/src/utils/formatters";
import { canManageProducts, getUserRole, mapAccessRoleToAppRole } from "./auth";
import { getSupabaseBrowserClient } from "./client";
import type { Database, Json } from "./database.types";
import {
  hasSupportedProductImageSignature,
  isSupportedProductImageMimeType,
  PRODUCT_IMAGE_FORMAT_LABEL,
} from "./productImagePolicy";
import { compressProductImageVariantsForUpload } from "../images/productImageCompression";

const PRODUCT_IMAGES_BUCKET = "product-images";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const PUBLISHED_PRODUCTS_PAGE_SIZE = 24;
const FIXED_PRODUCT_OPEN_UNTIL = "9999-12-31T23:59:59.000Z";
const PRODUCT_COLUMNS = [
  "id",
  "title",
  "description",
  "category",
  "created_at",
  "updated_at",
  "publish_at",
  "closes_at",
  "status",
  "sale_type",
  "fixed_price",
  "participant_count",
  "starting_price",
  "current_price",
  "bid_increment",
  "image_urls",
  "thumbnail_urls",
  "bid_history",
  "bid_locked_at",
  "final_bid_amount",
  "final_bid_id",
  "anti_sniping_base_closes_at",
  "anti_sniping_extended_at",
  "anti_sniping_extension_count",
].join(",");

type ProductRow = Database["public"]["Tables"]["products"]["Row"];
type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];

export class ProductRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProductRepositoryError";
  }
}

function isAuctionStatus(value: string): value is AuctionStatus {
  return value === "pending" || value === "active" || value === "closed";
}

function parseBidHistory(value: Json): readonly BidHistoryRecord[] {
  if (!Array.isArray(value)) return Object.freeze([]);

  const records = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const id = entry.id;
    const bidAt = entry.bidAt;
    const bidderName = entry.bidderName;
    const amount = entry.amount;
    const outcome = entry.outcome;

    if (
      typeof id !== "string" ||
      typeof bidAt !== "string" ||
      typeof bidderName !== "string" ||
      typeof amount !== "number"
    ) {
      return [];
    }

    if (
      outcome !== undefined &&
      outcome !== "active" &&
      outcome !== "cancelled" &&
      outcome !== "unpaid_cancelled"
    ) {
      return [];
    }

    return [
      Object.freeze({
        id,
        bidAt,
        bidderName,
        amount,
        outcome: outcome ?? "active",
      }),
    ];
  });

  return Object.freeze(records);
}

export function mapProductRowToAuctionPost(row: ProductRow): AuctionPost {
  if (!isAuctionStatus(row.status)) {
    throw new ProductRepositoryError("지원하지 않는 상품 상태를 받았습니다.");
  }

  return {
    id: row.id,
    updatedAt: row.updated_at,
    title: row.title,
    description: row.description,
    category: row.category || "구제 의류",
    createdAt: row.created_at,
    publish_at: row.publish_at,
    closesAt: row.closes_at,
    status: row.status,
    saleType: row.sale_type === "fixed" ? "fixed" : "auction",
    fixedPrice: row.sale_type === "fixed" ? row.fixed_price : null,
    participantCount: row.participant_count,
    startingPrice: row.starting_price,
    currentPrice: row.current_price,
    bidIncrement: row.bid_increment,
    imageUrls: row.image_urls,
    thumbnailUrls: row.image_urls.map(
      (imageUrl, index) => row.thumbnail_urls[index] || imageUrl,
    ),
    bidLockedAt: row.bid_locked_at ?? undefined,
    finalBidAmount: row.final_bid_amount ?? undefined,
    antiSnipingBaseClosesAt: row.anti_sniping_base_closes_at ?? undefined,
    antiSnipingExtendedAt: row.anti_sniping_extended_at ?? undefined,
    antiSnipingExtensionCount: row.anti_sniping_extension_count,
    bidHistory: parseBidHistory(row.bid_history),
  };
}

export interface ManagedProduct extends AuctionPost {
  updatedAt: string;
}

function mapProductRowToManagedProduct(row: ProductRow): ManagedProduct {
  return {
    ...mapProductRowToAuctionPost(row),
    updatedAt: row.updated_at,
  };
}

function getImageExtension(file: File): string {
  const fileExtension = file.name
    .split(".")
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  if (fileExtension && fileExtension.length <= 8) return fileExtension;

  const mimeExtension = file.type.split("/")[1]?.replace("jpeg", "jpg");
  return mimeExtension?.replace(/[^a-z0-9]/g, "") || "img";
}

function assertUploadableImage(file: File) {
  if (!isSupportedProductImageMimeType(file.type)) {
    throw new ProductRepositoryError(
      `${PRODUCT_IMAGE_FORMAT_LABEL} 사진만 업로드할 수 있어요.`,
    );
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new ProductRepositoryError("사진 한 장의 크기는 10MB 이하여야 해요.");
  }
}

async function removeUploadedImages(paths: readonly string[]) {
  if (paths.length === 0) return;

  try {
    await getSupabaseBrowserClient()
      .storage.from(PRODUCT_IMAGES_BUCKET)
      .remove([...paths]);
  } catch {
    // Preserve the original upload/database error. Orphan cleanup can be
    // retried from Storage without risking a second database write.
  }
}

export interface UploadedProductImages {
  imageUrls: string[];
  thumbnailUrls: string[];
  paths: string[];
}

export async function uploadProductImages(
  files: readonly File[],
  productId: string,
  onUploaded?: (completed: number, total: number) => void,
): Promise<UploadedProductImages> {
  if (files.length === 0) {
    throw new ProductRepositoryError("상품 사진을 하나 이상 선택해 주세요.");
  }

  const client = getSupabaseBrowserClient();
  const imageUrls: string[] = [];
  const thumbnailUrls: string[] = [];
  const paths: string[] = [];

  try {
    for (const file of files) {
      assertUploadableImage(file);
      if (!(await hasSupportedProductImageSignature(file))) {
        throw new ProductRepositoryError(
          "사진 파일의 실제 형식과 확장자 또는 MIME 정보가 일치하지 않아요.",
        );
      }
      const { imageFile, thumbnailFile } =
        await compressProductImageVariantsForUpload(file);
      const uniqueName = `${Date.now()}-${crypto.randomUUID()}`;
      const imagePath = `products/${productId}/images/${uniqueName}.${getImageExtension(imageFile)}`;
      const thumbnailPath = `products/${productId}/thumbnails/${uniqueName}.${getImageExtension(thumbnailFile)}`;
      const { data: imageData, error: imageError } = await client.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .upload(imagePath, imageFile, {
          cacheControl: "31536000",
          contentType: imageFile.type,
          upsert: false,
        });

      if (imageError) {
        throw new ProductRepositoryError(
          "사진 업로드에 실패했어요. Storage 버킷과 운영자 권한을 확인해 주세요.",
          { cause: imageError },
        );
      }

      paths.push(imageData.path);
      const { data: thumbnailData, error: thumbnailError } =
        await client.storage
          .from(PRODUCT_IMAGES_BUCKET)
          .upload(thumbnailPath, thumbnailFile, {
            cacheControl: "31536000",
            contentType: thumbnailFile.type,
            upsert: false,
          });
      if (thumbnailError) {
        throw new ProductRepositoryError(
          "미리보기 사진 업로드에 실패했어요. Storage 버킷과 운영자 권한을 확인해 주세요.",
          { cause: thumbnailError },
        );
      }

      paths.push(thumbnailData.path);
      const { data: imagePublicUrlData } = client.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .getPublicUrl(imageData.path);
      const { data: thumbnailPublicUrlData } = client.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .getPublicUrl(thumbnailData.path);
      imageUrls.push(imagePublicUrlData.publicUrl);
      thumbnailUrls.push(thumbnailPublicUrlData.publicUrl);
      onUploaded?.(imageUrls.length, files.length);
    }

    return { imageUrls, thumbnailUrls, paths };
  } catch (error) {
    await removeUploadedImages(paths);
    throw error;
  }
}

export interface CreatedProduct {
  id: string;
  imageUrls: string[];
  thumbnailUrls: string[];
}

interface ProductAccessRpcClient {
  rpc(
    functionName: "current_access_role" | "can_manage_products",
  ): PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
}

async function requireStaffSession() {
  const client = getSupabaseBrowserClient();
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();

  if (userError || !user || getUserRole(user) === "unauthorized") {
    throw new ProductRepositoryError(
      "등록된 운영자 또는 직원 계정으로 로그인 후 상품을 관리해 주세요.",
      userError ? { cause: userError } : undefined,
    );
  }

  const accessClient = client as unknown as ProductAccessRpcClient;
  const { data: accessRole, error: roleError } = await accessClient.rpc(
    "current_access_role",
  );
  const resolvedRole = mapAccessRoleToAppRole(accessRole);
  if (roleError || !canManageProducts(resolvedRole)) {
    throw new ProductRepositoryError(
      "이 카카오 계정에는 상품 업무 권한이 없습니다.",
      roleError ? { cause: roleError } : undefined,
    );
  }

  const { data: hasProductAccess, error: productAccessError } =
    await accessClient.rpc("can_manage_products");
  if (productAccessError || hasProductAccess !== true) {
    throw new ProductRepositoryError(
      "등록된 상품 업무 권한을 확인하지 못했어요. 다시 로그인해 주세요.",
      productAccessError ? { cause: productAccessError } : undefined,
    );
  }

  return client;
}

interface PreparedProductDraft {
  id: string;
  draft: NewAuctionDraft;
  publishAt: Date;
}

function prepareProductDraft(draft: NewAuctionDraft): PreparedProductDraft {
  const title = draft.title.trim();
  const description = draft.description.trim();
  const publishAt = new Date(draft.publish_at);
  const saleType: ProductSaleType =
    draft.saleType === "fixed" ? "fixed" : "auction";
  const productPrice =
    saleType === "fixed" ? draft.fixedPrice : draft.startingPrice;

  if (!title || title.length > 160) {
    throw new ProductRepositoryError("상품명은 160자 이내로 입력해 주세요.");
  }
  if (!description || description.length > 10_000) {
    throw new ProductRepositoryError(
      "상품 설명은 10,000자 이내로 입력해 주세요.",
    );
  }
  if (
    !Number.isSafeInteger(productPrice) ||
    productPrice === null ||
    productPrice < 1 ||
    productPrice > 1_000_000_000
  ) {
    throw new ProductRepositoryError(
      `${saleType === "fixed" ? "정가" : "시작가"}는 1원 이상 10억원 이하의 정수여야 해요.`,
    );
  }
  if (
    saleType === "auction" &&
    draft.fixedPrice !== null &&
    draft.fixedPrice !== undefined
  ) {
    throw new ProductRepositoryError("경매 상품에는 정가를 함께 저장할 수 없습니다.");
  }
  if (
    !Number.isSafeInteger(draft.bidIncrement) ||
    draft.bidIncrement < 1 ||
    draft.bidIncrement > 100_000_000
  ) {
    throw new ProductRepositoryError("입찰 단위를 확인해 주세요.");
  }
  if (draft.status !== "pending" && draft.status !== "active") {
    throw new ProductRepositoryError("등록할 상품 상태를 확인해 주세요.");
  }
  if (Number.isNaN(publishAt.getTime())) {
    throw new ProductRepositoryError("상품 공개 시간이 올바르지 않습니다.");
  }
  if (draft.imageFiles.length === 0) {
    throw new ProductRepositoryError("상품 사진을 하나 이상 선택해 주세요.");
  }
  draft.imageFiles.forEach(assertUploadableImage);

  return {
    id: crypto.randomUUID(),
    draft: {
      ...draft,
      title,
      description,
      saleType,
      fixedPrice: saleType === "fixed" ? productPrice : null,
      startingPrice: productPrice,
    },
    publishAt,
  };
}

function createProductInsert(
  prepared: PreparedProductDraft,
  imageUrls: string[],
  thumbnailUrls: string[],
): ProductInsert {
  const { draft, id, publishAt } = prepared;
  return {
    id,
    title: draft.title,
    description: draft.description,
    category: "구제 의류",
    publish_at: publishAt.toISOString(),
    closes_at:
      draft.saleType === "fixed"
        ? FIXED_PRODUCT_OPEN_UNTIL
        : getNextAuctionDeadline(publishAt).toISOString(),
    status: draft.status,
    sale_type: draft.saleType,
    fixed_price: draft.fixedPrice,
    participant_count: 0,
    starting_price: draft.startingPrice,
    current_price: draft.startingPrice,
    bid_increment: draft.bidIncrement,
    image_urls: imageUrls,
    thumbnail_urls: thumbnailUrls,
    bid_history: [],
  };
}

export async function createProduct(
  draft: NewAuctionDraft,
): Promise<CreatedProduct> {
  const client = await requireStaffSession();
  const prepared = prepareProductDraft(draft);
  const uploaded = await uploadProductImages(
    prepared.draft.imageFiles,
    prepared.id,
  );
  const row = createProductInsert(
    prepared,
    uploaded.imageUrls,
    uploaded.thumbnailUrls,
  );

  const { error } = await client.from("products").insert(row);
  if (error) {
    await removeUploadedImages(uploaded.paths);
    throw new ProductRepositoryError(
      "상품 저장에 실패했어요. products 테이블과 운영자 권한을 확인해 주세요.",
      { cause: error },
    );
  }

  return {
    id: prepared.id,
    imageUrls: uploaded.imageUrls,
    thumbnailUrls: uploaded.thumbnailUrls,
  };
}

export async function createProductsBatch(
  drafts: readonly NewAuctionDraft[],
  onProgress?: BatchAuctionProgressReporter,
): Promise<CreatedProduct[]> {
  if (drafts.length === 0) {
    throw new ProductRepositoryError("일괄 등록할 상품이 없습니다.");
  }
  if (drafts.length > 200) {
    throw new ProductRepositoryError(
      "한 번에 최대 200개 상품까지 등록할 수 있어요.",
    );
  }

  const preparedDrafts = drafts.map(prepareProductDraft);
  const totalImages = preparedDrafts.reduce(
    (total, prepared) => total + prepared.draft.imageFiles.length,
    0,
  );
  const client = await requireStaffSession();
  const uploadedPaths: string[] = [];
  const createdProducts: CreatedProduct[] = [];
  const rows: ProductInsert[] = [];
  let completedImages = 0;

  try {
    onProgress?.(0, totalImages, "uploading");
    for (const prepared of preparedDrafts) {
      const uploaded = await uploadProductImages(
        prepared.draft.imageFiles,
        prepared.id,
        (completedForProduct) => {
          onProgress?.(
            completedImages + completedForProduct,
            totalImages,
            "uploading",
          );
        },
      );
      completedImages += prepared.draft.imageFiles.length;
      uploadedPaths.push(...uploaded.paths);
      rows.push(
        createProductInsert(
          prepared,
          uploaded.imageUrls,
          uploaded.thumbnailUrls,
        ),
      );
      createdProducts.push({
        id: prepared.id,
        imageUrls: uploaded.imageUrls,
        thumbnailUrls: uploaded.thumbnailUrls,
      });
    }

    onProgress?.(totalImages, totalImages, "saving");
    const { error } = await client.from("products").insert(rows);
    if (error) {
      throw new ProductRepositoryError(
        "일괄 상품 저장에 실패했어요. 입력값과 운영자 권한을 확인해 주세요.",
        { cause: error },
      );
    }

    return createdProducts;
  } catch (error) {
    await removeUploadedImages(uploadedPaths);
    throw error;
  }
}

export async function fetchManagedProducts(): Promise<ManagedProduct[]> {
  const client = await requireStaffSession();
  const { data, error } = await client
    .from("products")
    .select(PRODUCT_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) {
    throw new ProductRepositoryError("운영 상품 목록을 불러오지 못했어요.", {
      cause: error,
    });
  }

  return ((data ?? []) as unknown as ProductRow[]).map(
    mapProductRowToManagedProduct,
  );
}

export interface PublishPendingProductsResult {
  requestedCount: number;
  publishedCount: number;
  skippedCount: number;
  publishedIds: string[];
  skippedIds: string[];
  publishedAt: string;
  closesAt: string;
}

export async function publishPendingProductsNow(
  productIds: readonly string[],
): Promise<PublishPendingProductsResult> {
  const uniqueProductIds = [...new Set(productIds.filter(Boolean))];
  if (uniqueProductIds.length === 0) {
    throw new ProductRepositoryError(
      "즉시 공개할 대기 상품을 하나 이상 선택해 주세요.",
    );
  }
  if (uniqueProductIds.length > 200) {
    throw new ProductRepositoryError(
      "한 번에 최대 200개 상품까지 즉시 공개할 수 있어요.",
    );
  }

  const client = await requireStaffSession();
  const { data, error } = await client
    .rpc("publish_pending_products_now", {
      p_product_ids: uniqueProductIds,
    })
    .single();

  if (error || !data) {
    throw new ProductRepositoryError(
      error?.message || "선택한 대기 상품을 즉시 공개하지 못했어요.",
      error ? { cause: error } : undefined,
    );
  }

  return {
    requestedCount: data.requested_count,
    publishedCount: data.published_count,
    skippedCount: data.skipped_count,
    publishedIds: data.published_ids,
    skippedIds: data.skipped_ids,
    publishedAt: data.published_at,
    closesAt: data.closes_at,
  };
}

export interface ManagedProductUpdate {
  title: string;
  description: string;
  startingPrice: number;
  bidIncrement: number;
  status: AuctionStatus;
  publishAt: string;
  expectedUpdatedAt: string;
}

export async function updateManagedProduct(
  productId: string,
  input: ManagedProductUpdate,
): Promise<ManagedProduct> {
  const client = await requireStaffSession();
  const { data, error } = await client
    .rpc("update_managed_product", {
      p_product_id: productId,
      p_title: input.title,
      p_description: input.description,
      p_starting_price: input.startingPrice,
      p_bid_increment: input.bidIncrement,
      p_status: input.status,
      p_publish_at: input.publishAt,
      p_expected_updated_at: input.expectedUpdatedAt,
    })
    .single();

  if (error || !data) {
    throw new ProductRepositoryError(
      error?.message || "상품을 수정하지 못했어요.",
      error ? { cause: error } : undefined,
    );
  }

  return mapProductRowToManagedProduct(data as unknown as ProductRow);
}

function getStoragePathFromPublicUrl(publicUrl: string): string | null {
  try {
    const pathname = new URL(publicUrl).pathname;
    const marker = `/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/`;
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const path = decodeURIComponent(
      pathname.slice(markerIndex + marker.length),
    );
    return path.startsWith("products/") ? path : null;
  } catch {
    return null;
  }
}

export async function deleteManagedProduct(
  productId: string,
  expectedUpdatedAt: string,
): Promise<void> {
  const client = await requireStaffSession();
  const { data, error } = await client.rpc("delete_managed_product", {
    p_product_id: productId,
    p_expected_updated_at: expectedUpdatedAt,
  });

  if (error) {
    throw new ProductRepositoryError(error.message, { cause: error });
  }

  const paths = (data ?? []).flatMap((url) => {
    const path = getStoragePathFromPublicUrl(url);
    return path ? [path] : [];
  });
  // The database deletion is authoritative. Storage cleanup is best-effort so
  // a transient object API failure cannot make the UI retry an already-deleted
  // product and report a misleading failure.
  await removeUploadedImages(paths);
}

export interface PublishedProductsPage {
  posts: AuctionPost[];
  page: number;
  hasMore: boolean;
}

export interface FetchPublishedProductsPageOptions {
  page?: number;
  now?: Date;
}

export async function fetchPublishedProductsPage({
  page = 0,
  now = new Date(),
}: FetchPublishedProductsPageOptions = {}): Promise<PublishedProductsPage> {
  if (!Number.isSafeInteger(page) || page < 0) {
    throw new ProductRepositoryError("상품 페이지 번호가 올바르지 않습니다.");
  }

  const client = getSupabaseBrowserClient();
  const nowIso = now.toISOString();
  const rangeStart = page * PUBLISHED_PRODUCTS_PAGE_SIZE;
  const rangeEnd = rangeStart + PUBLISHED_PRODUCTS_PAGE_SIZE - 1;
  const { data, error, count } = await client
    .from("products")
    .select(PRODUCT_COLUMNS, { count: "exact" })
    .eq("status", "active")
    .eq("sale_type", "auction")
    .lte("publish_at", nowIso)
    .order("publish_at", { ascending: false })
    .order("id", { ascending: false })
    .range(rangeStart, rangeEnd);

  if (error) {
    throw new ProductRepositoryError(
      "경매 상품을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
      { cause: error },
    );
  }

  const posts = ((data ?? []) as unknown as ProductRow[])
    .map(mapProductRowToAuctionPost)
    .filter(
      (post) =>
        post.status === "active" &&
        Date.parse(post.publish_at ?? post.createdAt) <= now.getTime(),
    );

  return {
    posts,
    page,
    hasMore:
      typeof count === "number"
        ? rangeStart + (data?.length ?? 0) < count
        : (data?.length ?? 0) === PUBLISHED_PRODUCTS_PAGE_SIZE,
  };
}

/** 정가 상점 전용 페이지 조회입니다. 경매 피드와 서버 범위를 분리합니다. */
export async function fetchPublishedFixedProductsPage({
  page = 0,
  now = new Date(),
}: FetchPublishedProductsPageOptions = {}): Promise<PublishedProductsPage> {
  if (!Number.isSafeInteger(page) || page < 0) {
    throw new ProductRepositoryError("상품 페이지 번호가 올바르지 않습니다.");
  }

  const client = getSupabaseBrowserClient();
  const nowIso = now.toISOString();
  const rangeStart = page * PUBLISHED_PRODUCTS_PAGE_SIZE;
  const rangeEnd = rangeStart + PUBLISHED_PRODUCTS_PAGE_SIZE - 1;
  const { data, error, count } = await client
    .from("products")
    .select(PRODUCT_COLUMNS, { count: "exact" })
    .eq("status", "active")
    .eq("sale_type", "fixed")
    .lte("publish_at", nowIso)
    .order("publish_at", { ascending: false })
    .order("id", { ascending: false })
    .range(rangeStart, rangeEnd);

  if (error) {
    throw new ProductRepositoryError(
      "정가 상품을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
      { cause: error },
    );
  }

  const posts = ((data ?? []) as unknown as ProductRow[])
    .map(mapProductRowToAuctionPost)
    .filter(
      (post) =>
        post.saleType === "fixed" &&
        post.status === "active" &&
        Date.parse(post.publish_at ?? post.createdAt) <= now.getTime(),
    );

  return {
    posts,
    page,
    hasMore:
      typeof count === "number"
        ? rangeStart + (data?.length ?? 0) < count
        : (data?.length ?? 0) === PUBLISHED_PRODUCTS_PAGE_SIZE,
  };
}

export interface FixedPriceClaimResult {
  productId: string;
  bidId: string;
  buyerId: string;
  buyerDisplayName: string;
  amount: number;
  claimedAt: string;
}

/** 서버 행 잠금으로 정가 상품을 한 번만 구매 확정합니다. */
export async function claimFixedPriceProduct(
  productId: string,
): Promise<FixedPriceClaimResult> {
  if (!productId.trim()) {
    throw new ProductRepositoryError("구매할 상품을 선택해 주세요.");
  }

  const client = getSupabaseBrowserClient();
  const { data, error } = await client
    .rpc("claim_fixed_price_product", { p_product_id: productId })
    .single();

  if (error || !data) {
    throw new ProductRepositoryError(
      error?.message ?? "정가 상품 구매를 확정하지 못했어요.",
      error ? { cause: error } : undefined,
    );
  }

  return {
    productId: data.product_id,
    bidId: data.bid_id,
    buyerId: data.buyer_id,
    buyerDisplayName: data.buyer_display_name,
    amount: data.amount,
    claimedAt: data.claimed_at,
  };
}

/**
 * 기존 호출부 호환용 첫 페이지 조회입니다. 추가 페이지가 필요한 화면은
 * fetchPublishedProductsPage를 사용해 서버 범위를 명시합니다.
 */
export async function fetchPublishedProducts(
  now: Date = new Date(),
): Promise<AuctionPost[]> {
  const firstPage = await fetchPublishedProductsPage({ now });
  return firstPage.posts;
}
