import type { MetadataRoute } from "next";
import { fetchSoldArchivePage, fetchSoldBrands } from "@/services/sold";

const SITE_URL = "https://www.ninety-nine-vintage.store";

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
    { url: `${SITE_URL}/sold`, changeFrequency: "daily", priority: 0.8 },
  ];
  try {
    const [products, brands] = await Promise.all([fetchAllSoldProducts(), fetchSoldBrands()]);
    return [...staticEntries, ...brands.map((brand) => ({ url: `${SITE_URL}/sold/brand/${encodeURIComponent(brand.brand_slug)}`, changeFrequency: "weekly" as const, priority: 0.7 })), ...products.map((product) => ({ url: `${SITE_URL}/sold/${product.product_id}`, lastModified: new Date(product.sold_at), changeFrequency: "never" as const, priority: 0.6 }))];
  } catch {
    return staticEntries;
  }
}
