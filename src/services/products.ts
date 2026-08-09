import "server-only";

import { createSupabasePublicClient, createSupabaseUserClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  normalizeCatalogSearch,
  normalizeProductLimit,
  normalizeProductOffset,
} from "@/lib/catalog/query";
import { formatProductDisplayNumber } from "@/lib/productDisplayNumber";
import { isSoldFeedVisible } from "@/lib/catalog/soldVisibility";

type ProductRow = Database["public"]["Tables"]["products"]["Row"] & {
  enhanced_title?: string | null;
  hashtags?: string[] | null;
};

function sanitizePublicBidHistory(value: Json): Json {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const amount = Number(record.amount);
    if (typeof record.id !== "string" || !Number.isSafeInteger(amount)) return [];
    const bidderName = typeof record.bidderName === "string" ? record.bidderName.trim() : "";
    if (!bidderName) return [];
    const outcome = record.outcome ?? "active";
    if (outcome !== "active" && outcome !== "cancelled" && outcome !== "unpaid_cancelled") return [];
    return [{
      id: record.id,
      bidAt: typeof record.bidAt === "string" ? record.bidAt : null,
      bidderName,
      amount,
      outcome: outcome,
    }];
  });
}

function resolveSizeLabel(title: string, sizeLabel: string | null): string {
  const value = sizeLabel?.trim();
  if (value) return value;
  const match = title.match(/^\[([^\]]+)\]/);
  return match?.[1]?.trim() ?? "";
}

export interface PublishedProduct {
  id: string;
  title: string;
  description: string;
  category: string;
  brand: string;
  brandSlug: string;
  gender: "" | "남성" | "여성" | "공용";
  publishAt: string;
  closesAt: string;
  status: ProductRow["status"];
  saleType: ProductRow["sale_type"];
  startingPrice: number;
  currentPrice: number;
  fixedPrice: number | null;
  bidIncrement: number;
  participantCount: number;
  imageUrls: string[];
  thumbnailUrls: string[];
  bidHistory: Json;
  bidLockedAt: string | null;
  finalBidAmount: number | null;
  antiSnipingBaseClosesAt: string | null;
  antiSnipingExtendedAt: string | null;
  antiSnipingExtensionCount: number;
  updatedAt: string;
  storeId: string | null;
  storeName: string;
  storeSlug: string;
  storageClass: "small" | "large";
  sizeLabel: string;
  conditionGrade: "" | "S" | "A+" | "A" | "B";
  measurements: Json;
  inspectionNotes: string[];
  enhancedTitle: string | null;
  hashtags: string[];
}

export interface SoldFeedProduct extends PublishedProduct {
  soldAt: string;
  soldPrice: number;
}

export function mapPublishedProduct(row: ProductRow & { stores?: { name?: string; slug?: string } | null }): PublishedProduct {
  return {
    id: row.id,
    title: row.title || formatProductDisplayNumber(row.id),
    description: row.description,
    category: row.category,
    brand: row.brand,
    brandSlug: row.brand_slug,
    gender:
      row.gender === "남성" || row.gender === "여성" || row.gender === "공용"
        ? row.gender
        : "",
    publishAt: row.publish_at,
    closesAt: row.closes_at,
    status: row.status,
    saleType: row.sale_type,
    startingPrice: row.starting_price,
    currentPrice: row.current_price,
    fixedPrice: row.fixed_price,
    bidIncrement: row.bid_increment,
    participantCount: row.participant_count,
    imageUrls: row.image_urls,
    thumbnailUrls: row.thumbnail_urls,
    bidHistory: sanitizePublicBidHistory(row.bid_history),
    bidLockedAt: row.bid_locked_at,
    finalBidAmount: row.final_bid_amount,
    antiSnipingBaseClosesAt: row.anti_sniping_base_closes_at,
    antiSnipingExtendedAt: row.anti_sniping_extended_at,
    antiSnipingExtensionCount: row.anti_sniping_extension_count,
    updatedAt: row.updated_at,
    storeId: row.store_id,
    storeName: row.stores?.name?.trim() ?? "",
    storeSlug: row.stores?.slug?.trim() ?? "",
    storageClass: row.storage_class === "large" ? "large" : "small",
    sizeLabel: resolveSizeLabel(row.title, row.size_label),
    conditionGrade: ["S", "A+", "A", "B"].includes(row.condition_grade) ? row.condition_grade as "S" | "A+" | "A" | "B" : "",
    measurements: row.measurements,
    inspectionNotes: row.inspection_notes,
    enhancedTitle: row.enhanced_title ?? null,
    hashtags: Array.isArray(row.hashtags) ? row.hashtags.filter((t): t is string => typeof t === "string") : [],
  };
}

export async function fetchPublishedProducts(input: {
  limit?: number;
  offset?: number;
  saleType?: ProductRow["sale_type"];
  search?: string;
} = {}): Promise<PublishedProduct[]> {
  const {
    limit = 24,
    offset = 0,
    saleType = "auction",
    search = "",
  } = input;
  const safeLimit = normalizeProductLimit(limit);
  const safeOffset = normalizeProductOffset(offset);
  const safeSearch = normalizeCatalogSearch(search);
  const verifier = createSupabasePublicClient();
  const now = new Date().toISOString();
  let query = verifier
    .from("products")
    .select("*, stores(name, slug)")
    .eq("sale_type", saleType)
    .lte("publish_at", now);
  if (saleType === "auction") {
    query = query
      .or(
        `and(status.eq.active,auction_feed_expires_at.gt.${now},final_bid_id.is.null),` +
        "and(status.eq.closed,final_bid_id.not.is.null,final_bid_amount.not.is.null,sale_completed_at.is.null)",
      );
  } else {
    query = query.eq("status", "active");
  }
  if (safeSearch) query = query.or(`title.ilike.%${safeSearch}%,description.ilike.%${safeSearch}%`);
  query = query.order("publish_at", { ascending: false });
  query = query.order("id", { ascending: true });
  const { data, error } = await query.range(safeOffset, safeOffset + safeLimit - 1);
  if (error) throw new Error("상품 목록을 불러오지 못했습니다.");
  return (data ?? []).map((row) => mapPublishedProduct(row as ProductRow & { stores?: { name?: string; slug?: string } | null }));
}

export async function fetchSoldFeedProducts(input: {
  limit?: number;
  offset?: number;
  saleType: ProductRow["sale_type"];
}): Promise<SoldFeedProduct[]> {
  const safeLimit = normalizeProductLimit(input.limit ?? 100);
  const safeOffset = normalizeProductOffset(input.offset ?? 0);
  const { data, error } = await createSupabasePublicClient().rpc(
    "get_public_sold_feed_products",
    {
      p_limit: safeLimit,
      p_offset: safeOffset,
      p_sale_type: input.saleType,
    },
  );
  if (error) throw new Error("판매 완료 상품을 불러오지 못했습니다.");

  return (data ?? []).filter((row) => row.sale_type !== "auction" || isSoldFeedVisible(row.closes_at)).map((row) => ({
    antiSnipingBaseClosesAt: row.anti_sniping_base_closes_at,
    antiSnipingExtendedAt: row.anti_sniping_extended_at,
    antiSnipingExtensionCount: row.anti_sniping_extension_count,
    bidHistory: row.bid_history,
    bidIncrement: row.bid_increment,
    bidLockedAt: row.bid_locked_at,
    brand: row.brand,
    brandSlug: row.brand_slug,
    gender: "",
    category: row.category,
    closesAt: row.closes_at,
    conditionGrade: "",
    currentPrice: row.current_price,
    description: row.description,
    finalBidAmount: row.final_bid_amount,
    fixedPrice: row.fixed_price,
    id: row.id,
    imageUrls: row.image_urls,
    inspectionNotes: [],
    measurements: {},
    participantCount: row.participant_count,
    publishAt: row.publish_at,
    saleType: row.sale_type === "fixed" ? "fixed" : "auction",
    sizeLabel: row.size_label,
    soldAt: row.sold_at,
    soldPrice: row.sold_price,
    startingPrice: row.starting_price,
    status: "closed",
    storageClass: "small",
    storeId: null,
    storeName: "",
    storeSlug: "",
    thumbnailUrls: row.thumbnail_urls,
    title: row.title,
    updatedAt: row.sold_at,
    enhancedTitle: null,
    hashtags: [],
  }));
}

export async function fetchPublicPremiumStoreIds(): Promise<Set<string>> {
  const { data, error } = await createSupabasePublicClient().rpc("get_public_premium_store_ids");
  if (error) throw new Error("프리미엄 센터 정보를 불러오지 못했습니다.");
  return new Set((data ?? []).map((row) => row.store_id));
}

export async function fetchStoreSoldFeedProducts(input: {
  storeId: string;
  saleType: ProductRow["sale_type"];
  limit?: number;
}): Promise<SoldFeedProduct[]> {
  const { data, error } = await createSupabasePublicClient().rpc(
    "get_public_store_sold_feed_products",
    { p_store_id: input.storeId, p_sale_type: input.saleType, p_limit: normalizeProductLimit(input.limit ?? 24) },
  );
  if (error) throw new Error("매장 판매 완료 상품을 불러오지 못했습니다.");
  return (data ?? []).filter((row) => row.sale_type !== "auction" || isSoldFeedVisible(row.closes_at)).map((row) => ({
    antiSnipingBaseClosesAt: row.anti_sniping_base_closes_at,
    antiSnipingExtendedAt: row.anti_sniping_extended_at,
    antiSnipingExtensionCount: row.anti_sniping_extension_count,
    bidHistory: row.bid_history,
    bidIncrement: row.bid_increment,
    bidLockedAt: row.bid_locked_at,
    brand: row.brand, brandSlug: row.brand_slug, gender: "", category: row.category,
    closesAt: row.closes_at, conditionGrade: "", currentPrice: row.current_price,
    description: row.description, finalBidAmount: row.final_bid_amount, fixedPrice: row.fixed_price,
    id: row.id, imageUrls: row.image_urls, inspectionNotes: [], measurements: {},
    participantCount: row.participant_count, publishAt: row.publish_at,
    saleType: row.sale_type === "fixed" ? "fixed" : "auction", sizeLabel: row.size_label,
    soldAt: row.sold_at, soldPrice: row.sold_price, startingPrice: row.starting_price,
    status: "closed", storageClass: "small", storeId: input.storeId, storeName: "", storeSlug: "",
    thumbnailUrls: row.thumbnail_urls, title: row.title, updatedAt: row.sold_at,
    enhancedTitle: null, hashtags: [],
  }));
}

export async function fetchPublishedProduct(productId: string): Promise<PublishedProduct | null> {
  const verifier = createSupabasePublicClient();
  const now = new Date().toISOString();
  const { data, error } = await verifier
    .from("products")
    .select("*, stores(name, slug)")
    .eq("id", productId)
    .lte("publish_at", now)
    .or(
      "and(status.eq.active,sale_type.eq.fixed)," +
      `and(status.eq.active,sale_type.eq.auction,auction_feed_expires_at.gt.${now},final_bid_id.is.null),` +
      "and(status.eq.closed,sale_type.eq.auction,final_bid_id.not.is.null,final_bid_amount.not.is.null,sale_completed_at.is.null)",
    )
    .maybeSingle();
  if (error) throw new Error("상품을 불러오지 못했습니다.");
  return data ? mapPublishedProduct(data as ProductRow & { stores?: { name?: string; slug?: string } | null }) : null;
}

export async function publishPendingProductsNow(accessToken: string, productIds: string[]) {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) throw new Error("공개할 상품이 없습니다.");
  const { data, error } = await createSupabaseUserClient(accessToken).rpc("publish_pending_products_now", { p_product_ids: ids });
  if (error) throw new Error(error.message || "상품 상태를 변경하지 못했습니다.");
  return data;
}

export async function updateManagedProductStatus(input: {
  accessToken: string;
  productId: string;
  title: string;
  description: string;
  startingPrice: number;
  bidIncrement: number;
  status: "pending" | "active" | "closed";
  publishAt: string;
  expectedUpdatedAt: string;
}) {
  const { data, error } = await createSupabaseUserClient(input.accessToken).rpc("update_managed_product", {
    p_product_id: input.productId,
    p_title: input.title.trim(),
    p_description: input.description.trim(),
    p_starting_price: input.startingPrice,
    p_bid_increment: input.bidIncrement,
    p_status: input.status,
    p_publish_at: input.publishAt,
    p_expected_updated_at: input.expectedUpdatedAt,
  });
  if (error) throw new Error(error.message || "상품 상태를 변경하지 못했습니다.");
  return data;
}
