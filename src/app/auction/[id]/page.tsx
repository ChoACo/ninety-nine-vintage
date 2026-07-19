import type { ItemDetail } from "@/types/detail";
import { notFound } from "next/navigation";
import { fetchPublishedProduct } from "@/services/products";
import { ConditionReport } from "@/components/features/auction/detail/ConditionReport";
import { ItemGallery } from "@/components/features/auction/detail/ItemGallery";
import { StickyBidPanel } from "@/components/features/auction/detail/StickyBidPanel";
import { getDemoProduct } from "@/lib/catalog";

const lot099: ItemDetail = {
  id: "099",
  auctionId: "DROP-01",
  name: "90s Varsity Leather Jacket",
  brand: "AVIREX VINTAGE",
  category: "Outer",
  description: "90s era vintage leather varsity jacket",
  imageUrl: "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=1200&q=90",
  images: [
    "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=1200&q=90",
    "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?w=1200&q=90",
    "https://images.unsplash.com/photo-1551488831-00ddcb6c6bd3?w=1200&q=90",
    "https://images.unsplash.com/photo-1548883354-7622d03aca27?w=1200&q=90",
    "https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=1200&q=90",
    "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=1200&q=90",
  ],
  condition: "EXCELLENT",
  conditionGrade: "A+",
  size: "L",
  startingPrice: 80000,
  currentBid: 125000,
  bidCount: 14,
  status: "active",
  saleType: "auction",
  measurements: { shoulder: 52, chest: 60, sleeve: 64, length: 74 },
  inspectionNotes: [
    "가죽 표면에 자연스러운 에이징과 미세한 주름이 있습니다.",
    "왼쪽 소매 끝에 작은 생활 오염이 있으나 착용 시 크게 드러나지 않습니다.",
    "안감과 지퍼는 원형 그대로이며 기능상 이상이 없습니다.",
  ],
  bidHistory: [
    { id: "bid-5", itemId: "099", bidderId: "u5", bidderName: "", bidderMaskedId: "vin****", amount: 125000, createdAt: "2026-07-19T16:58:00+09:00", timeLabel: "방금 전" },
    { id: "bid-4", itemId: "099", bidderId: "u4", bidderName: "", bidderMaskedId: "arch****", amount: 120000, createdAt: "2026-07-19T16:54:00+09:00", timeLabel: "4분 전" },
    { id: "bid-3", itemId: "099", bidderId: "u3", bidderName: "", bidderMaskedId: "vint****", amount: 115000, createdAt: "2026-07-19T16:49:00+09:00", timeLabel: "9분 전" },
    { id: "bid-2", itemId: "099", bidderId: "u2", bidderName: "", bidderMaskedId: "seou****", amount: 105000, createdAt: "2026-07-19T16:42:00+09:00", timeLabel: "16분 전" },
    { id: "bid-1", itemId: "099", bidderId: "u1", bidderName: "", bidderMaskedId: "old****", amount: 95000, createdAt: "2026-07-19T16:35:00+09:00", timeLabel: "23분 전" },
  ],
};

export const dynamic = "force-dynamic";

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
    return [{
      id: value.id,
      itemId: product.id,
      bidderId: "masked",
      bidderName: maskedBidder,
      bidderMaskedId: maskedBidder,
      amount,
      createdAt: typeof value.bidAt === "string" ? value.bidAt : new Date().toISOString(),
      timeLabel: index === 0 ? "최근" : "기록됨",
    }];
  });
  return {
    ...lot099,
    id: product.id,
    auctionId: product.id,
    name: product.title,
    brand: "NINETY-NINE VINTAGE",
    category: product.category,
    description: product.description,
    imageUrl: product.imageUrls[0] ?? product.thumbnailUrls[0] ?? "",
    images: product.imageUrls.length > 0 ? product.imageUrls : product.thumbnailUrls,
    startingPrice: product.startingPrice,
    currentBid: product.currentPrice,
    fixedPrice: product.saleType === "fixed" ? product.currentPrice : null,
    bidCount: product.participantCount,
    status: product.status,
    bidHistory,
    saleType: product.saleType,
  };
}

export default async function AuctionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let item: ItemDetail | null = null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    try {
      item = mapPublishedProductToDetail(await fetchPublishedProduct(id));
    } catch {
      item = null;
    }
  } else {
    const demo = getDemoProduct(id);
    if (demo) {
      item = {
        ...lot099,
        id: demo.id,
        auctionId: demo.id,
        name: demo.title,
        brand: demo.store.name,
        category: demo.category,
        description: demo.description,
        imageUrl: demo.imageUrls[0],
        images: demo.imageUrls,
        condition: demo.condition,
        conditionGrade: demo.conditionGrade,
        size: demo.size,
        startingPrice: demo.startingPrice,
        currentBid: demo.price,
        fixedPrice: demo.saleType === "fixed" ? demo.price : null,
        bidCount: demo.bidCount,
        status: "active",
        saleType: demo.saleType,
        closesAt: demo.closesAt,
        measurements: demo.measurements,
        inspectionNotes: demo.inspectionNotes,
        bidHistory: [],
      };
    }
  }

  if (!item) notFound();

  return (
    <div className="grid grid-cols-12 gap-12">
      <div className="col-span-7">
        <ItemGallery item={item} />
        <ConditionReport item={item} />
      </div>
      <StickyBidPanel item={item} />
    </div>
  );
}
