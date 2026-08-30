import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { CatalogImage } from "@/components/ui/CatalogImage";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ProductFeedTags } from "@/components/features/catalog/ProductFeedTags";
import type { PublishedProduct } from "@/services/products";

function VerticalSalesList({ basePath, eyebrow, href, products, title }: { basePath: string; eyebrow: string; href: string; products: PublishedProduct[]; title: string }) {
  return <section className="min-w-0 border border-line bg-surface p-5">
    <SectionHeading action={<Link className="flex items-center gap-1 text-xs font-bold hover:underline" href={href} prefetch={false}>전체 보기 <ArrowUpRight size={14} /></Link>} className="mb-4" eyebrow={eyebrow} title={title} titleClassName="mt-2 text-xl font-black tracking-[-0.05em]" />
    {products.length === 0 ? <div className="border border-dashed border-line py-12 text-center text-sm text-muted">현재 공개된 상품이 없습니다.</div> : <ul className="divide-y divide-line">{products.map((product) => {
      const price = product.saleType === "fixed" ? product.fixedPrice ?? product.currentPrice : product.currentPrice;
      return <li key={product.id}><Link className="group flex min-w-0 items-center gap-3 py-3 transition-colors hover:bg-surface" href={`${basePath}/${product.saleType === "fixed" ? "shop" : "auction"}/${product.id}`} prefetch={false}><CatalogImage alt={`${product.brand} ${product.title}`} className="size-14 shrink-0 object-cover" loading="lazy" maxDimension={320} sizes="56px" src={product.thumbnailUrls[0] ?? product.imageUrls[0] ?? ""} /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold">{product.title}</span><ProductFeedTags description={product.description} gender={product.gender} size={product.sizeLabel} /><span className="mt-1 block text-[10px] text-muted">{product.saleType === "fixed" ? "즉시 구매" : "경매"}</span></span><span className="shrink-0 text-right"><span className="block font-mono text-xs font-bold">{price.toLocaleString("ko-KR")}원</span><span className="mt-1 block text-[10px] text-muted">{product.saleType === "fixed" ? "즉시 구매" : "진행 중"}</span></span></Link></li>;
    })}</ul>}
  </section>;
}

export function StoreMallSplitSales({ auctions, basePath = "", fixed, selectedDate, slug, surface }: { auctions: PublishedProduct[]; basePath?: "" | "/m"; fixed: PublishedProduct[]; selectedDate: string; slug: string; surface: "desktop" | "mobile" }) {
  const isDesktop = surface === "desktop";
  return <section className={`mt-16 grid items-start gap-8 ${isDesktop ? "grid-cols-2" : "grid-cols-1"}`} aria-label="센터 판매 현황">
    <VerticalSalesList basePath={basePath} eyebrow={`${selectedDate} · LIVE AUCTION`} href={`${basePath}/stores/${encodeURIComponent(slug)}/auction`} products={auctions} title="센터 경매관" />
    <VerticalSalesList basePath={basePath} eyebrow={`${selectedDate} · BUY NOW`} href={`${basePath}/stores/${encodeURIComponent(slug)}/buy`} products={fixed} title="센터 즉시구매관" />
  </section>;
}
