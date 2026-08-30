import type { MetadataRoute } from "next";
import { buildPublicCatalogVisibilityFilter } from "@/lib/catalog/publicProductVisibility";
import { createSupabasePublicClient } from "@/lib/supabase/server";
import { fetchSoldArchivePage, fetchSoldBrands } from "@/services/sold";
import { fetchActiveStores } from "@/services/stores";

const SITE_URL = "https://www.ninety-nine-vintage.store";
const MAX_SITEMAP_ENTRIES = 50_000;
const DATABASE_PAGE_SIZE = 1_000;

export const revalidate = 3_600;

interface PublishedProductSitemapRow {
  id: string;
  sale_type: string;
  updated_at: string;
}

async function fetchAllPublishedProducts(): Promise<PublishedProductSitemapRow[]> {
  const verifier = createSupabasePublicClient();
  const now = new Date().toISOString();
  const products: PublishedProductSitemapRow[] = [];

  for (let offset = 0; products.length < MAX_SITEMAP_ENTRIES; offset += DATABASE_PAGE_SIZE) {
    const remaining = MAX_SITEMAP_ENTRIES - products.length;
    const pageSize = Math.min(DATABASE_PAGE_SIZE, remaining);
    const { data, error } = await verifier
      .from("products")
      .select("id, sale_type, updated_at")
      .lte("publish_at", now)
      .or(buildPublicCatalogVisibilityFilter(now))
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error("공개 상품 사이트맵을 불러오지 못했습니다.");
    const rows = (data ?? []).filter(
      (row): row is PublishedProductSitemapRow =>
        row.sale_type === "auction" || row.sale_type === "fixed",
    );
    products.push(...rows);
    if ((data?.length ?? 0) < pageSize) break;
  }

  return products;
}

async function fetchAllSoldProducts() {
  const products: Awaited<ReturnType<typeof fetchSoldArchivePage>>["products"] = [];
  let before: string | undefined;
  let beforeId: string | undefined;
  while (products.length < 50_000) {
    const page = await fetchSoldArchivePage({ limit: 99, before, beforeId });
    products.push(...page.products);
    const last = page.products.at(-1);
    if (!page.hasNext || !last) break;
    before = last.sold_at;
    beforeId = last.product_id;
  }
  return products;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/home`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/shop`, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/feed`, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/live`, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/centers`, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/sold`, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/refund`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "monthly", priority: 0.2 },
    { url: `${SITE_URL}/terms`, changeFrequency: "monthly", priority: 0.2 },
  ];

  const [publishedResult, storesResult, soldResult, brandsResult] = await Promise.allSettled([
    fetchAllPublishedProducts(),
    fetchActiveStores(),
    fetchAllSoldProducts(),
    fetchSoldBrands(),
  ]);
  const publishedProducts = publishedResult.status === "fulfilled" ? publishedResult.value : [];
  const stores = storesResult.status === "fulfilled" ? storesResult.value : [];
  const soldProducts = soldResult.status === "fulfilled" ? soldResult.value : [];
  const brands = brandsResult.status === "fulfilled" ? brandsResult.value : [];
  const visibleSoldBrandSlugs = new Set(
    soldProducts.map((product) => product.brand_slug),
  );
  const visibleSoldBrands = brands.filter((brand) =>
    visibleSoldBrandSlugs.has(brand.brand_slug),
  );

  const dynamicEntries: MetadataRoute.Sitemap = [
    ...publishedProducts.map((product) => ({
      url: `${SITE_URL}/${product.sale_type === "fixed" ? "shop" : "auction"}/${product.id}`,
      lastModified: new Date(product.updated_at),
      changeFrequency: "daily" as const,
      priority: product.sale_type === "fixed" ? 0.8 : 0.9,
    })),
    ...stores.map((store) => ({
      url: `${SITE_URL}/centers/${encodeURIComponent(store.slug)}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...visibleSoldBrands.map((brand) => ({
      url: `${SITE_URL}/sold/brand/${encodeURIComponent(brand.brand_slug)}`,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...soldProducts.map((product) => ({
      url: `${SITE_URL}/sold/${product.product_id}`,
      lastModified: new Date(product.sold_at),
      changeFrequency: "never" as const,
      priority: 0.6,
    })),
  ];

  const seen = new Set<string>();
  return [...staticEntries, ...dynamicEntries]
    .filter((entry) => !seen.has(entry.url) && Boolean(seen.add(entry.url)))
    .slice(0, MAX_SITEMAP_ENTRIES);
}
