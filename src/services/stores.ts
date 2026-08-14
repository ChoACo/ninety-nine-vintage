import "server-only";

import { createSupabasePublicClient } from "@/lib/supabase/server";
import { mapPublishedProduct, type PublishedProduct } from "@/services/products";
import { getKstDateRange } from "@/lib/catalogDate";

export interface PublicStore {
  id: string;
  slug: string;
  name: string;
  description: string;
}

export async function fetchActiveStores(): Promise<PublicStore[]> {
  const verifier = createSupabasePublicClient();
  const { data, error } = await verifier.from("stores").select("id, slug, name, description").eq("is_active", true).order("name");
  if (error) throw new Error("숍 목록을 불러오지 못했습니다.");
  return (data ?? []).map((store) => ({ id: store.id, slug: store.slug, name: store.name, description: store.description }));
}

export async function fetchStoreBySlug(slug: string): Promise<PublicStore | null> {
  const verifier = createSupabasePublicClient();
  const { data, error } = await verifier
    .from("stores")
    .select("id, slug, name, description")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error("숍 정보를 불러오지 못했습니다.");
  return data
    ? { id: data.id, slug: data.slug, name: data.name, description: data.description }
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
