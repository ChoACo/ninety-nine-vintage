import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { AuctionDetailView } from "@/components/features/auction/detail/AuctionDetailView";
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
    canonicalPath: `/auction/${product.id}`,
    imageUrls: product.imageUrls,
    price: product.currentPrice,
    availability: product.status === "closed" ? "SoldOut" : "InStock",
    saleKind: "auction",
    conditionGrade: product.conditionGrade,
    sizeLabel: product.sizeLabel,
    priceValidUntil: product.closesAt,
    storeName: product.storeName,
  };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const product = await loadPublishedProductForSeo(id).catch(() => null);
  return product?.saleType === "auction" ? buildProductMetadata(seoInput(product)) : {};
}

export default async function MobileAuctionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await loadPublishedProductForSeo(id).catch(() => null);
  if (!product) notFound();
  if (product.saleType === "fixed") permanentRedirect(`/m/shop/${id}`);
  return <AuctionDetailView id={id} product={product} surface="mobile" />;
}
