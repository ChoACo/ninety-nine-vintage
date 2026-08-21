import type { Metadata } from "next";
import { AuctionDetailView } from "@/components/features/auction/detail/AuctionDetailView";
import { getCatalogImageUrl } from "@/lib/images";
import { fetchPublishedProduct } from "@/services/products";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return {};
  const product = await fetchPublishedProduct(id).catch(() => null);
  if (!product) return {};
  const title = `${product.title} | ${product.brand}`;
  const priceLabel = product.saleType === "fixed" ? "판매 정가" : "현재 입찰가";
  const price = product.saleType === "fixed" ? product.fixedPrice ?? product.currentPrice : product.currentPrice;
  const priceText = `${priceLabel} ${price.toLocaleString("ko-KR")}원`;
  const description = product.description ? `${priceText} · ${product.description}`.slice(0, 200) : priceText;
  const url = `/auction/${id}`;
  const imageUrl = product.imageUrls[0] ? getCatalogImageUrl(product.imageUrls[0], 800) : undefined;
  const images = imageUrl ? [{ url: imageUrl, alt: product.title }] : undefined;
  return { title, description, alternates: { canonical: url, media: { "only screen and (max-width: 1279px)": `/m${url}` } }, openGraph: { title, description, url, type: "website", images } };
}

export default async function AuctionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AuctionDetailView id={id} />;
}
