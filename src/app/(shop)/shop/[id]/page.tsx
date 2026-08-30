import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuctionDetailView } from "@/components/features/auction/detail/AuctionDetailView";
import { VaultShippingBanner } from "@/components/features/shop/detail/VaultShippingBanner";
import { buildProductMetadata, type ProductSeoInput } from "@/lib/seo/productSeo";
import { loadPublishedProductForSeo } from "@/lib/seo/productLoaders.server";
import type { PublishedProduct } from "@/services/products";

export const dynamic = "force-dynamic";

function seoInput(product: PublishedProduct): ProductSeoInput {
  return {
    id: product.id,
    title: product.title,
    description: product.description,
    brand: product.brand,
    category: product.category,
    canonicalPath: `/shop/${product.id}`,
    imageUrls: product.imageUrls,
    price: product.fixedPrice ?? product.currentPrice,
    availability: product.status === "closed" ? "SoldOut" : "InStock",
    saleKind: "fixed",
    conditionGrade: product.conditionGrade,
    sizeLabel: product.sizeLabel,
    storeName: product.storeName,
  };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const product = await loadPublishedProductForSeo(id).catch(() => null);
  return product?.saleType === "fixed" ? buildProductMetadata(seoInput(product)) : {};
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await loadPublishedProductForSeo(id).catch(() => null);
  if (!product || product.saleType !== "fixed") notFound();
  return (
    <div className="space-y-7">
      <div>
        <Link className="text-xs font-bold text-muted underline" href="/shop">← 아카이브 숍으로</Link>
        <p className="mt-5 text-[10px] font-black tracking-[.16em] text-amber-600">ONE OF ONE ARCHIVE</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-.05em]">{product.title}</h1>
      </div>
      <VaultShippingBanner />
      <AuctionDetailView id={id} product={product} />
    </div>
  );
}
