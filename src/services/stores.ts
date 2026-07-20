import "server-only";

import { createSupabasePublicClient } from "@/lib/supabase/server";
import { mapPublishedProduct, type PublishedProduct } from "@/services/products";

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
  const stores = await fetchActiveStores();
  return stores.find((store) => store.slug === slug) ?? null;
}

export async function fetchStoreProducts(storeId: string, saleType?: "auction" | "fixed"): Promise<PublishedProduct[]> {
  const verifier = createSupabasePublicClient();
  let query = verifier.from("products").select("*").eq("store_id", storeId).eq("status", "active").lte("publish_at", new Date().toISOString());
  if (saleType) query = query.eq("sale_type", saleType);
  const { data, error } = await query.order("publish_at", { ascending: false }).limit(100);
  if (error) throw new Error("숍 상품을 불러오지 못했습니다.");
  return (data ?? []).map(mapPublishedProduct);
}
