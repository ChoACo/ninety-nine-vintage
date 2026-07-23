import { notFound } from "next/navigation";
import { ConditionReport } from "@/components/features/auction/detail/ConditionReport";
import { ItemGallery } from "@/components/features/auction/detail/ItemGallery";
import { StickyBidPanel } from "@/components/features/auction/detail/StickyBidPanel";
import { fetchPublishedProduct } from "@/services/products";
import type { BidHistoryEntry, ConditionGrade, ItemDetail, ItemMeasurements } from "@/types/detail";

function measurements(value: unknown): ItemMeasurements {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { shoulder: 0, chest: 0, sleeve: 0, length: 0 };
  const record = value as Record<string, unknown>;
  return { shoulder: Number(record.shoulder) || 0, chest: Number(record.chest) || 0, sleeve: Number(record.sleeve) || 0, length: Number(record.length) || 0 };
}

function mapPublishedProductToDetail(product: Awaited<ReturnType<typeof fetchPublishedProduct>>): ItemDetail | null {
  if (!product) return null;
  const records = Array.isArray(product.bidHistory) ? product.bidHistory : [];
  const bidHistory = records.flatMap((record, index): BidHistoryEntry[] => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return [];
    const value = record as Record<string, unknown>;
    const amount = Number(value.amount);
    if (typeof value.id !== "string" || !Number.isSafeInteger(amount)) return [];
    const outcome = value.outcome ?? "active";
    if (outcome !== "active" && outcome !== "cancelled" && outcome !== "unpaid_cancelled") return [];
    const bidder = typeof value.bidderName === "string" ? value.bidderName : "회원";
    return [{ id: value.id, itemId: product.id, bidderId: "public", bidderName: bidder, bidderMaskedId: bidder, amount, createdAt: typeof value.bidAt === "string" ? value.bidAt : new Date().toISOString(), outcome, timeLabel: index === 0 ? "최근" : "기록됨" }];
  });
  const conditionGrade: ConditionGrade = product.conditionGrade;
  const condition = conditionGrade === "S" ? "NEW" : conditionGrade === "B" ? "FAIR" : conditionGrade === "A+" ? "EXCELLENT" : "GOOD";
  const saleType = product.saleType === "fixed" ? "fixed" : "auction";
  return {
    id: product.id,
    auctionId: product.id,
    name: product.title,
    brand: product.brand,
    category: product.category,
    description: product.description,
    imageUrl: product.imageUrls[0] ?? product.thumbnailUrls[0] ?? "",
    images: product.imageUrls.length > 0 ? product.imageUrls : product.thumbnailUrls,
    condition,
    conditionGrade,
    size: product.sizeLabel,
    startingPrice: product.startingPrice,
    currentBid: product.currentPrice,
    fixedPrice: saleType === "fixed" ? product.fixedPrice ?? product.currentPrice : null,
    bidCount: product.participantCount,
    participantCount: product.participantCount,
    bidLockedAt: product.bidLockedAt,
    finalBidAmount: product.finalBidAmount,
    antiSnipingBaseClosesAt: product.antiSnipingBaseClosesAt,
    antiSnipingExtendedAt: product.antiSnipingExtendedAt,
    antiSnipingExtensionCount: product.antiSnipingExtensionCount,
    status: product.status === "pending" || product.status === "closed" ? product.status : "active",
    saleType,
    closesAt: product.closesAt,
    publishAt: product.publishAt,
    bidIncrement: product.bidIncrement,
    measurements: measurements(product.measurements),
    inspectionNotes: product.inspectionNotes,
    bidHistory,
  };
}

export async function AuctionDetailView({ id, compact = false, surface = "desktop" }: { id: string; compact?: boolean; surface?: "desktop" | "mobile" }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) notFound();
  const item = mapPublishedProductToDetail(await fetchPublishedProduct(id));
  if (!item) notFound();
  return <div className={`grid gap-8 ${surface === "desktop" ? "grid-cols-12 gap-12" : "grid-cols-1"}`} data-detail-layout={compact ? "intercepted" : "page"} data-detail-surface={surface}><div className={surface === "desktop" ? "col-span-7 min-w-0" : "min-w-0"}><ItemGallery compact={compact} item={item} surface={surface} /><ConditionReport item={item} surface={surface} /></div><StickyBidPanel basePath={surface === "mobile" ? "/m" : ""} compact={compact} item={item} key={item.id} surface={surface} /></div>;
}
