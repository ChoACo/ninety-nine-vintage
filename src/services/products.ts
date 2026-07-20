import "server-only";

import { createSupabasePublicClient, createSupabaseUserClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";
import { normalizeCatalogSearch, normalizeProductLimit } from "@/lib/catalog/query";

type ProductRow = Database["public"]["Tables"]["products"]["Row"];

function maskBidderName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "member****";
  const normalized = value.trim();
  return `${normalized.slice(0, Math.min(3, normalized.length))}****`;
}

function maskPublicBidHistory(value: Json): Json {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const amount = Number(record.amount);
    if (typeof record.id !== "string" || !Number.isSafeInteger(amount)) return [];
    return [{
      id: record.id,
      bidAt: typeof record.bidAt === "string" ? record.bidAt : null,
      bidderName: maskBidderName(record.bidderName),
      amount,
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
  updatedAt: string;
  storeId: string | null;
  storageClass: "small" | "large";
  sizeLabel: string;
  conditionGrade: "S" | "A+" | "A" | "B";
  measurements: Json;
  inspectionNotes: string[];
}

export function mapPublishedProduct(row: ProductRow): PublishedProduct {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
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
    bidHistory: maskPublicBidHistory(row.bid_history),
    bidLockedAt: row.bid_locked_at,
    finalBidAmount: row.final_bid_amount,
    updatedAt: row.updated_at,
    storeId: row.store_id,
    storageClass: row.storage_class === "large" ? "large" : "small",
    sizeLabel: resolveSizeLabel(row.title, row.size_label),
    conditionGrade: ["S", "A+", "A", "B"].includes(row.condition_grade) ? row.condition_grade as "S" | "A+" | "A" | "B" : "A",
    measurements: row.measurements,
    inspectionNotes: row.inspection_notes,
  };
}

export async function fetchPublishedProducts(input: {
  limit?: number;
  saleType?: ProductRow["sale_type"];
  search?: string;
  sort?: "latest" | "ending" | "price_asc" | "price_desc";
} = {}): Promise<PublishedProduct[]> {
  const { limit = 24, saleType = "auction", search = "", sort = "latest" } = input;
  const safeLimit = normalizeProductLimit(limit);
  const safeSearch = normalizeCatalogSearch(search);
  const verifier = createSupabasePublicClient();
  const now = new Date().toISOString();
  let query = verifier
    .from("products")
    .select("*")
    .eq("status", "active")
    .eq("sale_type", saleType)
    .lte("publish_at", now);
  if (saleType === "auction") {
    query = query
      .gt("auction_feed_expires_at", now)
      .is("final_bid_id", null);
  }
  if (safeSearch) query = query.or(`title.ilike.%${safeSearch}%,description.ilike.%${safeSearch}%`);
  if (sort === "ending") query = query.order("closes_at", { ascending: true });
  else if (sort === "price_asc") query = query.order(saleType === "fixed" ? "fixed_price" : "current_price", { ascending: true, nullsFirst: false });
  else if (sort === "price_desc") query = query.order(saleType === "fixed" ? "fixed_price" : "current_price", { ascending: false, nullsFirst: false });
  else query = query.order("publish_at", { ascending: false });
  const { data, error } = await query.limit(safeLimit);
  if (error) throw new Error("상품 목록을 불러오지 못했습니다.");
  return (data ?? []).map(mapPublishedProduct);
}

export async function fetchPublishedProduct(productId: string): Promise<PublishedProduct | null> {
  const verifier = createSupabasePublicClient();
  const now = new Date().toISOString();
  const { data, error } = await verifier
    .from("products")
    .select("*")
    .eq("id", productId)
    .eq("status", "active")
    .lte("publish_at", now)
    .maybeSingle();
  if (error) throw new Error("상품을 불러오지 못했습니다.");
  if (data?.sale_type === "auction" && (data.final_bid_id !== null || data.auction_feed_expires_at === null || data.auction_feed_expires_at <= now)) return null;
  return data ? mapPublishedProduct(data) : null;
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
