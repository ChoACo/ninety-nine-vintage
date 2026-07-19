import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { AuctionCard } from "@/components/features/auction/AuctionCard";
import type { CatalogProduct } from "@/lib/catalog";

function toItem(product: CatalogProduct) {
  return { id: product.id, auctionId: product.id, name: product.title, brand: product.store.name, category: product.category, description: product.description, imageUrl: product.imageUrls[0], thumbnailUrl: product.imageUrls[0], startingPrice: product.startingPrice, currentBid: product.price, fixedPrice: product.saleType === "fixed" ? product.price : null, bidCount: product.bidCount, status: "active" as const, saleType: product.saleType, closesAt: product.closesAt, bidIncrement: 1000, timeLeft: product.saleType === "fixed" ? "IN STOCK" : "LIVE" };
}

export function ProductRail({ products, title, eyebrow, href = "/feed" }: { products: CatalogProduct[]; title: string; eyebrow: string; href?: string }) {
  return <section className="mt-20">
    <div className="mb-6 flex items-end justify-between border-b border-ink pb-4"><div><p className="eyebrow text-muted">{eyebrow}</p><h2 className="mt-2 text-2xl font-black tracking-[-0.06em]">{title}</h2></div><Link className="flex items-center gap-1 text-xs font-bold hover:underline" href={href}>전체 보기 <ArrowUpRight size={14} /></Link></div>
    <div className="grid grid-cols-2 gap-x-3 gap-y-9 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{products.map((product) => <AuctionCard item={toItem(product)} key={product.id} />)}</div>
  </section>;
}

