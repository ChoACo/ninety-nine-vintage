import { fetchPublishedProducts } from "@/services/products";
import { getCatalogImageUrl } from "@/lib/images";
import { normalizeProductLimit, normalizeProductOffset } from "@/lib/catalog/query";

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const limit = normalizeProductLimit(searchParams.get("limit") ?? "24");
  const offset = normalizeProductOffset(searchParams.get("offset") ?? "0");
  const saleType = searchParams.get("saleType") === "fixed" ? "fixed" : "auction";
  const sort = ["latest", "ending", "price_asc", "price_desc"].includes(searchParams.get("sort") ?? "")
    ? (searchParams.get("sort") as "latest" | "ending" | "price_asc" | "price_desc")
    : "latest";
  try {
    const products = await fetchPublishedProducts({
      limit,
      offset,
      saleType,
      sort,
      search: searchParams.get("q") ?? "",
    });
    const hasMore = products.length === limit;
    return Response.json({
      products: products.map((product) => ({
        ...product,
        imageUrls: product.imageUrls.map((image) => getCatalogImageUrl(image)),
        thumbnailUrls: product.thumbnailUrls.map((image) => getCatalogImageUrl(image, 320)),
      })),
      pagination: {
        hasMore,
        limit,
        nextOffset: hasMore ? offset + products.length : null,
        offset,
        returned: products.length,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { products: [], dbConnected: false, error: "상품 목록을 불러오지 못했습니다." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
