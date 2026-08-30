import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { AuctionDetailView } from "@/components/features/auction/detail/AuctionDetailView";
import { buildProductMetadata, type ProductSeoInput } from "@/lib/seo/productSeo";
import { loadPublishedProductForSeo } from "@/lib/seo/productLoaders.server";
import type { PublishedProduct } from "@/services/products";

export const dynamic = "force-dynamic";

function seoInput(product: PublishedProduct): ProductSeoInput {
  const canonicalPath = `/${product.saleType === "fixed" ? "shop" : "auction"}/${product.id}` as const;
  return {
    id: product.id,
    title: product.title,
    description: product.description,
    brand: product.brand,
    category: product.category,
    canonicalPath,
    imageUrls: product.imageUrls,
    price: product.saleType === "fixed"
      ? (product.fixedPrice ?? product.currentPrice)
      : product.currentPrice,
    availability: product.status === "closed" ? "SoldOut" : "InStock",
    saleKind: product.saleType === "fixed" ? "fixed" : "auction",
    conditionGrade: product.conditionGrade,
    sizeLabel: product.sizeLabel,
    priceValidUntil: product.saleType === "auction" ? product.closesAt : null,
    storeName: product.storeName,
  };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const product = await loadPublishedProductForSeo(id).catch(() => null);
  return product ? buildProductMetadata(seoInput(product)) : {};
}

export default async function AuctionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await loadPublishedProductForSeo(id).catch(() => null);
  if (!product) notFound();
  if (product.saleType === "fixed") permanentRedirect(`/shop/${id}`);
  return <AuctionDetailView id={id} product={product} />;
}
