import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { AuctionCard } from "@/components/features/auction/AuctionCard";
import type { PublishedProduct } from "@/services/products";

function toItem(product: PublishedProduct) {
  const status = product.status === "pending" || product.status === "closed" ? product.status : "active";
  const saleType = product.saleType === "fixed" ? "fixed" : "auction";
  return {
    id: product.id,
    auctionId: product.id,
    name: product.title,
    brand: "NINETY-NINE VINTAGE",
    category: product.category,
    description: product.description,
    imageUrl: product.thumbnailUrls[0] ?? product.imageUrls[0] ?? "",
    thumbnailUrl: product.thumbnailUrls[0] ?? product.imageUrls[0] ?? "",
    startingPrice: product.startingPrice,
    currentBid: product.currentPrice,
    fixedPrice: saleType === "fixed" ? product.fixedPrice ?? product.currentPrice : null,
    bidCount: product.participantCount,
    status,
    saleType,
    closesAt: product.closesAt,
    publishAt: product.publishAt,
    bidIncrement: product.bidIncrement,
    timeLeft: saleType === "fixed" ? "IN STOCK" : "LIVE",
  } as const;
}

export function ProductRail({ products, title, eyebrow, href = "/feed" }: { products: PublishedProduct[]; title: string; eyebrow: string; href?: string }) {
  return <section className="mt-20"><div className="mb-6 flex items-end justify-between border-b border-ink pb-4"><div><p className="eyebrow text-muted">{eyebrow}</p><h2 className="mt-2 text-2xl font-black tracking-[-0.06em]">{title}</h2></div><Link className="flex items-center gap-1 text-xs font-bold hover:underline" href={href}>전체 보기 <ArrowUpRight size={14} /></Link></div><div className="grid grid-cols-2 gap-x-3 gap-y-9 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{products.map((product) => <AuctionCard item={toItem(product)} key={product.id} />)}</div>{products.length === 0 && <div className="border border-dashed border-line py-16 text-center text-sm text-muted">현재 공개된 상품이 없습니다.</div>}</section>;
}
