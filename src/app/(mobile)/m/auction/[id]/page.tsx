import type { Metadata } from "next";
import { AuctionDetailView } from "@/components/features/auction/detail/AuctionDetailView";
import { fetchPublishedProduct } from "@/services/products";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const product = await fetchPublishedProduct(id).catch(() => null);
  if (!product) return {};
  return { title: product.title, description: product.description.slice(0, 160), alternates: { canonical: `/auction/${id}` } };
}

export default async function MobileAuctionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AuctionDetailView id={id} surface="mobile" />;
}
