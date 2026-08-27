import {
  fetchPublishedProducts,
  fetchPublicPremiumStoreIds,
  fetchSoldFeedProducts,
  fetchUpcomingAuctionProducts,
  fetchWonAuctionProducts,
} from "@/services/products";
import { getCatalogImageUrl } from "@/lib/images";
import { normalizeProductLimit, normalizeProductOffset } from "@/lib/catalog/query";

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const limit = normalizeProductLimit(searchParams.get("limit") ?? "24");
  const offset = normalizeProductOffset(searchParams.get("offset") ?? "0");
  const saleType = searchParams.get("saleType") === "fixed" ? "fixed" : "auction";
  const soldOnly = searchParams.get("view") === "sold";
  const upcomingOnly = saleType === "auction" && searchParams.get("view") === "upcoming";
  const wonOnly = saleType === "auction" && searchParams.get("view") === "won";
  try {
    const [products, premiumStoreIds] = await Promise.all([wonOnly
      ? fetchWonAuctionProducts({ limit, offset })
      : upcomingOnly
      ? fetchUpcomingAuctionProducts({ limit, offset })
      : soldOnly
      ? fetchSoldFeedProducts({ limit, offset, saleType })
      : fetchPublishedProducts({
        limit,
        offset,
        saleType,
        search: searchParams.get("q") ?? "",
      }), soldOnly ? Promise.resolve(new Set<string>()) : fetchPublicPremiumStoreIds()]);
    const hasMore = products.length === limit;
    return Response.json({
      products: products.map((product) => ({
        ...product,
        storeTier: product.storeId && premiumStoreIds.has(product.storeId) ? "premium" : "standard",
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
