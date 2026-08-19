import "server-only";

import { createSupabasePublicClient } from "@/lib/supabase/server";
import { mapPublishedProduct, type PublishedProduct } from "@/services/products";
import { getKstDateKey, getKstDateRange, getRecentCatalogDates } from "@/lib/catalogDate";

export interface PublicStore {
  id: string;
  slug: string;
  name: string;
  description: string;
  mallImage: string | null;
  mallInfo: string | null;
}

export interface StoreMallCard {
  id: string;
  slug: string;
  name: string;
  description: string;
  mallImage: string | null;
  mallInfo: string | null;
  recentCount: number;
  totalCount: number;
}

export async function fetchActiveStores(): Promise<PublicStore[]> {
  const verifier = createSupabasePublicClient();
  const { data, error } = await verifier.from("stores").select("id, slug, name, description, mall_info, mall_image").eq("is_active", true).order("name");
  // Public mall pages should remain usable during a transient catalog read
  // failure; the UI renders its empty-state instead of turning the whole page
  // into a 500 response.
  if (error) return [];
  return (data ?? []).map((store) => ({ id: store.id, slug: store.slug, name: store.name, description: store.description, mallInfo: store.mall_info, mallImage: store.mall_image }));
}

export async function fetchStoreMallCards(): Promise<StoreMallCard[]> {
  const verifier = createSupabasePublicClient();
  const now = new Date().toISOString();
  const recentWindow = getRecentCatalogDates(7);
  const recentFrom = getKstDateRange(recentWindow[recentWindow.length - 1]).from;
  const { data, error } = await verifier
    .from("stores")
    .select("id, slug, name, description, mall_info, mall_image")
    .eq("is_active", true)
    .order("name");
  // Keep the public center-mall shell available during transient catalog
  // read failures; callers render an empty-state when no cards are returned.
  if (error) return [];
  const rows = data ?? [];
  const counts = await Promise.all(
    rows.map(async (store) => {
      const [totalQuery, recentQuery] = await Promise.all([
        verifier
          .from("products")
          .select("id", { count: "exact", head: true })
          .eq("store_id", store.id)
          .eq("status", "active")
          .lte("publish_at", now),
        verifier
          .from("products")
          .select("id", { count: "exact", head: true })
          .eq("store_id", store.id)
          .eq("status", "active")
          .gte("publish_at", recentFrom)
          .lte("publish_at", now),
      ]);
      return {
        id: store.id,
        slug: store.slug,
        name: store.name,
        description: store.description,
        mallInfo: store.mall_info,
        mallImage: store.mall_image,
        recentCount: recentQuery.count ?? 0,
        totalCount: totalQuery.count ?? 0,
      };
    }),
  );
  return counts;
}

export async function fetchStoreBySlug(slug: string): Promise<PublicStore | null> {
  const verifier = createSupabasePublicClient();
  const { data, error } = await verifier
    .from("stores")
    .select("id, slug, name, description, mall_info, mall_image")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error("숍 정보를 불러오지 못했습니다.");
  return data
    ? { id: data.id, slug: data.slug, name: data.name, description: data.description, mallInfo: data.mall_info, mallImage: data.mall_image }
    : null;
}

export async function fetchStoreProducts(storeId: string, saleType?: "auction" | "fixed", publishedDate?: string): Promise<PublishedProduct[]> {
  const verifier = createSupabasePublicClient();
  let query = verifier.from("products").select("*").eq("store_id", storeId).eq("status", "active").lte("publish_at", new Date().toISOString());
  if (saleType) query = query.eq("sale_type", saleType);
  if (publishedDate) {
    const range = getKstDateRange(publishedDate);
    query = query.gte("publish_at", range.from).lt("publish_at", range.to);
  }
  const { data, error } = await query.order("publish_at", { ascending: false }).limit(100);
  if (error) throw new Error("숍 상품을 불러오지 못했습니다.");
  return (data ?? []).map(mapPublishedProduct);
}

export async function fetchStoreProductDates(storeId: string): Promise<string[]> {
  const verifier = createSupabasePublicClient();
  const { data, error } = await verifier
    .from("products")
    .select("publish_at")
    .eq("store_id", storeId)
    .eq("status", "active")
    .lte("publish_at", new Date().toISOString())
    .order("publish_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error("숍 상품 등록일을 불러오지 못했습니다.");
  return [...new Set((data ?? []).map((row) => getKstDateKey(row.publish_at)))];
}
