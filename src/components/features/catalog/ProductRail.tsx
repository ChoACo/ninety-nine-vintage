import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { AuctionCard } from "@/components/features/auction/AuctionCard";
import { getCatalogImageUrl } from "@/lib/images";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { SectionHeading } from "@/components/ui/SectionHeading";
import type { PublishedProduct } from "@/services/products";

function toItem(product: PublishedProduct) {
  const status = product.status === "pending" || product.status === "closed" ? product.status : "active";
  const saleType = product.saleType === "fixed" ? "fixed" : "auction";
  return {
    id: product.id,
    auctionId: product.id,
    name: product.title,
    brand: product.brand,
    category: product.category,
    description: product.description,
    imageUrl: getCatalogImageUrl(product.thumbnailUrls[0] ?? product.imageUrls[0] ?? ""),
    thumbnailUrl: getCatalogImageUrl(product.thumbnailUrls[0] ?? product.imageUrls[0] ?? ""),
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

export function ProductRail({ products, title, eyebrow, href = "/feed", compact = false }: { products: PublishedProduct[]; title: string; eyebrow: string; href?: string; compact?: boolean }) {
  return <section className="mt-20"><SectionHeading action={<Link className="flex items-center gap-1 text-xs font-bold hover:underline" href={href}>전체 보기 <ArrowUpRight size={14} /></Link>} className="mb-6" eyebrow={eyebrow} title={title} titleClassName="mt-2 text-2xl font-black tracking-[-0.06em]" />{compact ? <div className="grid gap-2  grid-cols-3">{products.map((product) => <Link className="flex min-w-0 items-center gap-3 border-b border-line py-3 transition-colors hover:bg-surface" href={"/auction/" + product.id} key={product.id}><CatalogImage alt="" className="size-14 shrink-0 object-cover" loading="lazy" maxDimension={320} src={product.thumbnailUrls[0] ?? product.imageUrls[0] ?? ""} /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold">{product.title}</span><span className="mt-1 block text-[10px] text-muted">{product.sizeLabel || "사이즈 미등록"} · {product.saleType === "fixed" ? "즉시구매" : "경매"}</span></span><span className="shrink-0 text-right"><span className="block font-mono text-xs font-bold">{(product.saleType === "fixed" ? product.fixedPrice ?? product.currentPrice : product.currentPrice).toLocaleString("ko-KR")}원</span><span className="mt-1 block text-[10px] text-muted">{product.saleType === "fixed" ? "BUY NOW" : "LIVE"}</span></span></Link>)}</div> : <div className="grid grid-cols-2 gap-x-3 gap-y-9  grid-cols-4 xl:grid-cols-5">{products.map((product) => <AuctionCard item={toItem(product)} key={product.id} />)}</div>}{products.length === 0 && <div className="border border-dashed border-line py-16 text-center text-sm text-muted">현재 공개된 상품이 없습니다.</div>}</section>;
}
