import "server-only";

import { createSupabasePublicClient } from "@/lib/supabase/server";
import { getCatalogImageUrl } from "@/lib/images";
import type { Database } from "@/lib/supabase/database.types";

export const SOLD_PAGE_SIZE = 24;
export type SoldProduct = Database["public"]["Functions"]["get_public_sold_product"]["Returns"][number];
export type SoldBrand = Database["public"]["Functions"]["get_public_sold_brands"]["Returns"][number];

function mapImages<T extends { image_urls: string[]; thumbnail_urls: string[] }>(product: T): T {
  return {
    ...product,
    image_urls: (product.image_urls ?? []).map((image) => getCatalogImageUrl(image)),
    thumbnail_urls: (product.thumbnail_urls ?? []).map((image) => getCatalogImageUrl(image, 640)),
  };
}

export async function fetchSoldArchivePage(input: { before?: string; beforeId?: string; brandSlug?: string; limit?: number } = {}) {
  const limit = Math.min(Math.max(input.limit ?? SOLD_PAGE_SIZE, 1), 100);
  const verifier = createSupabasePublicClient();
  const { data, error } = await verifier.rpc("get_public_sold_auctions", {
    p_limit: limit + 1,
    p_before: input.before,
    p_before_id: input.beforeId,
    p_brand_slug: input.brandSlug,
  });
  if (error) throw new Error("판매 완료 아카이브를 불러오지 못했습니다.");
  const rows = (data ?? []).map(mapImages);
  return { products: rows.slice(0, limit), hasNext: rows.length > limit };
}

export async function fetchSoldBrands(): Promise<SoldBrand[]> {
  const { data, error } = await createSupabasePublicClient().rpc("get_public_sold_brands");
  if (error) throw new Error("판매 완료 브랜드를 불러오지 못했습니다.");
  return data ?? [];
}

export async function fetchSoldProduct(productId: string): Promise<SoldProduct | null> {
  const { data, error } = await createSupabasePublicClient().rpc("get_public_sold_product", { p_product_id: productId });
  if (error) throw new Error("판매 기록을 불러오지 못했습니다.");
  return data?.[0] ? mapImages(data[0]) : null;
}
