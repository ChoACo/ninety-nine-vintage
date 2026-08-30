import { notFound } from "next/navigation";
import { ConditionReport } from "@/components/features/auction/detail/ConditionReport";
import { ItemGallery } from "@/components/features/auction/detail/ItemGallery";
import { StickyBidPanel } from "@/components/features/auction/detail/StickyBidPanel";
import type { BidHistoryEntry, ItemDetail } from "@/types/detail";
import {
  normalizeConditionGrade,
  type ConditionGrade,
} from "@/lib/catalog/conditions";
import { normalizeMeasurements } from "@/lib/catalog/measurements";
import {
  buildBrandSearchLabel,
  buildProductJsonLd,
  serializeJsonLd,
} from "@/lib/seo/productSeo";
import { loadPublishedProductForSeo } from "@/lib/seo/productLoaders.server";
import type { PublishedProduct } from "@/services/products";

function mapPublishedProductToDetail(
  product: PublishedProduct,
): ItemDetail | null {
  if (!product) return null;
  const records = Array.isArray(product.bidHistory) ? product.bidHistory : [];
  const bidHistory = records.flatMap((record, index): BidHistoryEntry[] => {
    if (!record || typeof record !== "object" || Array.isArray(record))
      return [];
    const value = record as Record<string, unknown>;
    const amount = Number(value.amount);
    if (typeof value.id !== "string" || !Number.isSafeInteger(amount))
      return [];
    const outcome = value.outcome ?? "active";
    if (
      outcome !== "active" &&
      outcome !== "cancelled" &&
      outcome !== "unpaid_cancelled"
    )
      return [];
    const bidder =
      typeof value.bidderName === "string" ? value.bidderName : "회원";
    return [
      {
        id: value.id,
        itemId: product.id,
        bidderId: "public",
        bidderName: bidder,
        bidderMaskedId: bidder,
        amount,
        createdAt:
          typeof value.bidAt === "string"
            ? value.bidAt
            : new Date().toISOString(),
        outcome,
        timeLabel: index === 0 ? "최근" : "기록됨",
      },
    ];
  });
  const conditionGrade: ConditionGrade =
    normalizeConditionGrade(product.conditionGrade) ?? "";
  const condition =
    conditionGrade === "S"
      ? "NEW"
      : conditionGrade === "A"
        ? "EXCELLENT"
        : conditionGrade === "B"
          ? "GOOD"
          : conditionGrade === "C"
            ? "FAIR"
            : undefined;
  const saleType = product.saleType === "fixed" ? "fixed" : "auction";
  return {
    id: product.id,
    auctionId: product.id,
    name: product.title,
    brand: buildBrandSearchLabel(product.brand),
    category: product.category,
    description: product.description,
    imageUrl: product.imageUrls[0] ?? product.thumbnailUrls[0] ?? "",
    images:
      product.imageUrls.length > 0 ? product.imageUrls : product.thumbnailUrls,
    condition,
    conditionGrade,
    size: product.sizeLabel,
    startingPrice: product.startingPrice,
    currentBid: product.currentPrice,
    fixedPrice:
      saleType === "fixed"
        ? (product.fixedPrice ?? product.currentPrice)
        : null,
    bidCount: product.participantCount,
    participantCount: product.participantCount,
    bidLockedAt: product.bidLockedAt,
    finalBidAmount: product.finalBidAmount,
    antiSnipingBaseClosesAt: product.antiSnipingBaseClosesAt,
    antiSnipingExtendedAt: product.antiSnipingExtendedAt,
    antiSnipingExtensionCount: product.antiSnipingExtensionCount,
    status:
      product.status === "pending" || product.status === "closed"
        ? product.status
        : "active",
    saleType,
    closesAt: product.closesAt,
    publishAt: product.publishAt,
    bidIncrement: product.bidIncrement,
    measurements: normalizeMeasurements(product.measurements),
    inspectionNotes: product.inspectionNotes,
    defectTags: product.defectTags,
    bidHistory,
  };
}

export async function AuctionDetailView({
  id,
  product: suppliedProduct,
  compact = false,
  surface = "desktop",
}: {
  id: string;
  product?: PublishedProduct;
  compact?: boolean;
  surface?: "desktop" | "mobile";
}) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  )
    notFound();
  const product = suppliedProduct ?? await loadPublishedProductForSeo(id);
  if (!product) notFound();
  const item = mapPublishedProductToDetail(product);
  if (!item) notFound();
  const canonicalPath = `/${product.saleType === "fixed" ? "shop" : "auction"}/${id}` as const;
  const price = product.saleType === "fixed"
    ? (product.fixedPrice ?? product.currentPrice)
    : product.currentPrice;
  const jsonLd = buildProductJsonLd({
    id: product.id,
    title: product.title,
    description: product.description,
    brand: product.brand,
    category: product.category,
    canonicalPath,
    imageUrls: product.imageUrls,
    price,
    availability: product.status === "closed" ? "SoldOut" : "InStock",
    saleKind: product.saleType === "fixed" ? "fixed" : "auction",
    conditionGrade: product.conditionGrade,
    sizeLabel: product.sizeLabel,
    priceValidUntil: product.saleType === "auction" ? product.closesAt : null,
    storeName: product.storeName,
  });
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} type="application/ld+json" />
      <div
      className="mx-auto grid w-full max-w-[1400px] grid-cols-1 items-start gap-6 p-0 sm:grid-cols-12 sm:gap-8 sm:p-6 lg:grid-cols-[minmax(0,58fr)_minmax(340px,42fr)] lg:gap-10"
      data-detail-layout={compact ? "intercepted" : "page"}
      data-detail-surface={surface}
      >
      <div
        className="no-scrollbar min-w-0 overscroll-contain sm:col-span-6 md:col-span-7 lg:col-auto lg:h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pr-2"
        data-detail-gallery-scroll
      >
        <ItemGallery compact={compact} item={item} surface={surface} />
        <ConditionReport item={item} surface={surface} />
      </div>
      <StickyBidPanel
        basePath={surface === "mobile" ? "/m" : ""}
        compact={compact}
        item={item}
        key={item.id}
        surface={surface}
      />
      </div>
    </>
  );
}
