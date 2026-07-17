import type { NewAuctionDraft } from "@/src/components/feed";
import type {
  AuctionPost,
  AuctionStatus,
  BidHistoryRecord,
} from "@/src/types/auction";
import { getNextAuctionDeadline } from "@/src/utils/formatters";
import { isSupabaseAdmin } from "./adminAuth";
import { getSupabaseBrowserClient } from "./client";
import type { Database, Json } from "./database.types";
import {
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
    // 원래 업로드/INSERT 오류를 유지합니다. 고아 파일은 운영 로그에서 정리합니다.
  }
}

export interface UploadedProductImages {
  imageUrls: string[];
  paths: string[];
}

export async function uploadProductImages(
  files: readonly File[],
  productId: string,
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
          "사진 업로드에 실패했어요. Storage 버킷과 관리자 권한을 확인해 주세요.",
          { cause: error },
        );
      }

      paths.push(data.path);
      const { data: publicUrlData } = client.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .getPublicUrl(data.path);
      imageUrls.push(publicUrlData.publicUrl);
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

export async function createProduct(
  draft: NewAuctionDraft,
): Promise<CreatedProduct> {
  const client = getSupabaseBrowserClient();
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();

  if (userError || !isSupabaseAdmin(user)) {
    throw new ProductRepositoryError(
      "Supabase 관리자 로그인 후 상품을 등록해 주세요.",
      userError ? { cause: userError } : undefined,
    );
  }

  const id = crypto.randomUUID();
  const publishAt = new Date(draft.publish_at);

  if (Number.isNaN(publishAt.getTime())) {
    throw new ProductRepositoryError("상품 공개 시간이 올바르지 않습니다.");
  }

  const uploaded = await uploadProductImages(draft.imageFiles, id);
  const row: ProductInsert = {
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
    image_urls: uploaded.imageUrls,
    bid_history: [],
  };

  const { error } = await client.from("products").insert(row);

  if (error) {
    await removeUploadedImages(uploaded.paths);
    throw new ProductRepositoryError(
      "상품 저장에 실패했어요. products 테이블과 관리자 권한을 확인해 주세요.",
      { cause: error },
    );
  }

  return { id, imageUrls: uploaded.imageUrls };
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
