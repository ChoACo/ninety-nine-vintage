import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ConditionReport } from "@/components/features/auction/detail/ConditionReport";
import { ItemGallery } from "@/components/features/auction/detail/ItemGallery";
import { StickyBidPanel } from "@/components/features/auction/detail/StickyBidPanel";
import { fetchPublishedProduct } from "@/services/products";
import type { ItemDetail, ItemMeasurements, ConditionGrade } from "@/types/detail";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return {};
  const product = await fetchPublishedProduct(id).catch(() => null);
  if (!product) return {};
  const title = `${product.title} | ${product.brand}`;
  const description = product.description.slice(0, 160);
  const url = `/auction/${id}`;
  const images = product.imageUrls[0] ? [{ url: product.imageUrls[0], alt: product.title }] : undefined;
  return { title, description, alternates: { canonical: url }, openGraph: { title, description, url, type: "website", images } };
}

function measurements(value: unknown): ItemMeasurements {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { shoulder: 0, chest: 0, sleeve: 0, length: 0 };
  const record = value as Record<string, unknown>;
  return { shoulder: Number(record.shoulder) || 0, chest: Number(record.chest) || 0, sleeve: Number(record.sleeve) || 0, length: Number(record.length) || 0 };
}

function mapPublishedProductToDetail(product: Awaited<ReturnType<typeof fetchPublishedProduct>>): ItemDetail | null {
  if (!product) return null;
  const records = Array.isArray(product.bidHistory) ? product.bidHistory : [];
  const bidHistory = records.flatMap((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return [];
    const value = record as Record<string, unknown>;
    const amount = Number(value.amount);
    if (typeof value.id !== "string" || !Number.isSafeInteger(amount)) return [];
    const bidder = typeof value.bidderName === "string" ? value.bidderName : "member";
    const maskedBidder = `${bidder.slice(0, 3)}****`;
    return [{ id: value.id, itemId: product.id, bidderId: "masked", bidderName: maskedBidder, bidderMaskedId: maskedBidder, amount, createdAt: typeof value.bidAt === "string" ? value.bidAt : new Date().toISOString(), timeLabel: index === 0 ? "최근" : "기록됨" }];
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

export default async function AuctionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) notFound();
  const item = mapPublishedProductToDetail(await fetchPublishedProduct(id));
  if (!item) notFound();
  return <div className="grid grid-cols-1 gap-8 grid-cols-12 gap-12"><div className="min-w-0 col-span-7"><ItemGallery item={item} /><ConditionReport item={item} /></div><StickyBidPanel item={item} /></div>;
}
