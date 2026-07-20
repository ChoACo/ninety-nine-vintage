import { fetchPublishedProducts } from "@/services/products";
import { getCatalogImageUrl } from "@/lib/images";

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const limit = Number(searchParams.get("limit") ?? "24");
  const saleType = searchParams.get("saleType") === "fixed" ? "fixed" : "auction";
  const sort = ["latest", "ending", "price_asc", "price_desc"].includes(searchParams.get("sort") ?? "")
    ? (searchParams.get("sort") as "latest" | "ending" | "price_asc" | "price_desc")
    : "latest";
  try {
    const products = await fetchPublishedProducts({ limit, saleType, sort, search: searchParams.get("q") ?? "" });
    return Response.json({
      products: products.map((product) => ({
        ...product,
        imageUrls: product.imageUrls.map((image) => getCatalogImageUrl(image)),
        thumbnailUrls: product.thumbnailUrls.map((image) => getCatalogImageUrl(image, 320)),
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ products: [], dbConnected: false }, { headers: { "Cache-Control": "no-store" } });
  }
}
