import type { ProductPayload } from "@/components/features/auction/AuctionFeedGrid";
import type { PublishedProduct } from "@/services/products";

export function toFixedProductPayload(
  products: readonly PublishedProduct[],
): ProductPayload[] {
  return products.map((product) => ({
    id: product.id,
    title: product.title,
    description: product.description,
    category: product.category,
    brand: product.brand,
    brandSlug: product.brandSlug,
    gender: product.gender,
    conditionGrade: product.conditionGrade,
    measurements: product.measurements,
    publishAt: product.publishAt,
    closesAt: product.closesAt,
    status: "active",
    saleType: "fixed",
    startingPrice: product.startingPrice,
    currentPrice: product.currentPrice,
    fixedPrice: product.fixedPrice,
    bidIncrement: product.bidIncrement,
    participantCount: product.participantCount,
    bidHistory: Array.isArray(product.bidHistory) ? product.bidHistory : [],
    imageUrls: product.imageUrls,
    thumbnailUrls: product.thumbnailUrls,
    sizeLabel: product.sizeLabel,
    storeId: product.storeId,
    storeName: product.storeName,
    storeSlug: product.storeSlug,
    enhancedTitle: product.enhancedTitle,
    hashtags: product.hashtags,
  }));
}
