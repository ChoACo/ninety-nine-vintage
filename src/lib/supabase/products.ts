import type { NewAuctionDraft } from "@/src/components/feed";
import type { BatchAuctionProgressReporter } from "@/src/lib/import/batchAuction";
import type {
  AuctionPost,
  AuctionStatus,
  BidHistoryRecord,
} from "@/src/types/auction";
import { getNextAuctionDeadline } from "@/src/utils/formatters";
import {
  canManageProducts,
  getUserRole,
  mapAccessRoleToAppRole,
} from "./auth";
import { getSupabaseBrowserClient } from "./client";
import type { Database, Json } from "./database.types";
import {
  hasSupportedProductImageSignature,
  isSupportedProductImageMimeType,
  PRODUCT_IMAGE_FORMAT_LABEL,
} from "./productImagePolicy";

const PRODUCT_IMAGES_BUCKET = "product-images";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
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
  "participant_count",
  "starting_price",
  "current_price",
  "bid_increment",
  "image_urls",
  "bid_history",
  "bid_locked_at",
  "final_bid_amount",
  "final_bid_id",
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

    if (
      typeof id !== "string" ||
      typeof bidAt !== "string" ||
      typeof bidderName !== "string" ||
      typeof amount !== "number"
    ) {
      return [];
    }

    return [Object.freeze({ id, bidAt, bidderName, amount })];
  });

  return Object.freeze(records);
}

export function mapProductRowToAuctionPost(row: ProductRow): AuctionPost {
  if (!isAuctionStatus(row.status)) {
    throw new ProductRepositoryError("지원하지 않는 상품 상태를 받았습니다.");
  }

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category || "구제 의류",
    createdAt: row.created_at,
    publish_at: row.publish_at,
    closesAt: row.closes_at,
    status: row.status,
    participantCount: row.participant_count,
    startingPrice: row.starting_price,
    currentPrice: row.current_price,
    bidIncrement: row.bid_increment,
    imageUrls: row.image_urls,
    bidLockedAt: row.bid_locked_at ?? undefined,
    finalBidAmount: row.final_bid_amount ?? undefined,
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
    throw new ProductRepositoryError(
      "사진 한 장의 크기는 10MB 이하여야 해요.",
    );
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
  const paths: string[] = [];

  try {
    for (const file of files) {
      assertUploadableImage(file);
      if (!(await hasSupportedProductImageSignature(file))) {
        throw new ProductRepositoryError(
          "사진 파일의 실제 형식과 확장자 또는 MIME 정보가 일치하지 않아요.",
        );
      }
      const extension = getImageExtension(file);
      const path = `products/${productId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
      const { data, error } = await client.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .upload(path, file, {
          cacheControl: "31536000",
          contentType: file.type,
          upsert: false,
        });

      if (error) {
        throw new ProductRepositoryError(
          "사진 업로드에 실패했어요. Storage 버킷과 운영자 권한을 확인해 주세요.",
          { cause: error },
        );
      }

      paths.push(data.path);
      const { data: publicUrlData } = client.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .getPublicUrl(data.path);
      imageUrls.push(publicUrlData.publicUrl);
      onUploaded?.(imageUrls.length, files.length);
    }

    return { imageUrls, paths };
  } catch (error) {
    await removeUploadedImages(paths);
    throw error;
  }
}

export interface CreatedProduct {
  id: string;
  imageUrls: string[];
}

interface ProductAccessRpcClient {
  rpc(functionName: "current_access_role" | "can_manage_products"): PromiseLike<{
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

  if (!title || title.length > 160) {
    throw new ProductRepositoryError("상품명은 160자 이내로 입력해 주세요.");
  }
  if (!description || description.length > 10_000) {
    throw new ProductRepositoryError("상품 설명은 10,000자 이내로 입력해 주세요.");
  }
  if (
    !Number.isSafeInteger(draft.startingPrice) ||
    draft.startingPrice < 1 ||
    draft.startingPrice > 1_000_000_000
  ) {
    throw new ProductRepositoryError(
      "시작가는 1원 이상 10억원 이하의 정수여야 해요.",
    );
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
    draft: { ...draft, title, description },
    publishAt,
  };
}

function createProductInsert(
  prepared: PreparedProductDraft,
  imageUrls: string[],
): ProductInsert {
  const { draft, id, publishAt } = prepared;
  return {
    id,
    title: draft.title,
    description: draft.description,
    category: "구제 의류",
    publish_at: publishAt.toISOString(),
    closes_at: getNextAuctionDeadline(publishAt).toISOString(),
    status: draft.status,
    participant_count: 0,
    starting_price: draft.startingPrice,
    current_price: draft.startingPrice,
    bid_increment: draft.bidIncrement,
    image_urls: imageUrls,
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
  const row = createProductInsert(prepared, uploaded.imageUrls);

  const { error } = await client.from("products").insert(row);
  if (error) {
    await removeUploadedImages(uploaded.paths);
    throw new ProductRepositoryError(
      "상품 저장에 실패했어요. products 테이블과 운영자 권한을 확인해 주세요.",
      { cause: error },
    );
  }

  return { id: prepared.id, imageUrls: uploaded.imageUrls };
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
      rows.push(createProductInsert(prepared, uploaded.imageUrls));
      createdProducts.push({
        id: prepared.id,
        imageUrls: uploaded.imageUrls,
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
    const path = decodeURIComponent(pathname.slice(markerIndex + marker.length));
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

export async function fetchPublishedProducts(
  now: Date = new Date(),
): Promise<AuctionPost[]> {
  const client = getSupabaseBrowserClient();
  const nowIso = now.toISOString();
  const { data, error } = await client
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("status", "active")
    .lte("publish_at", nowIso)
    .order("publish_at", { ascending: false });

  if (error) {
    throw new ProductRepositoryError(
      "경매 상품을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
      { cause: error },
    );
  }

  return ((data ?? []) as unknown as ProductRow[])
    .map(mapProductRowToAuctionPost)
    .filter(
      (post) =>
        post.status === "active" &&
        Date.parse(post.publish_at ?? post.createdAt) <= now.getTime(),
    );
}
