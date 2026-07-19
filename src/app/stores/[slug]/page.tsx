import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductRail } from "@/components/features/catalog/ProductRail";
import { fetchStoreBySlug, fetchStoreProducts } from "@/services/stores";

export const dynamic = "force-dynamic";

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await fetchStoreBySlug(slug);
  if (!store) notFound();
  const products = await fetchStoreProducts(store.id);
  return <div><div className="flex min-h-[360px] flex-col justify-between bg-[#c7b9a5] p-8 md:p-14"><div><p className="eyebrow">CURATED STORE / {store.operatorId.slice(0, 8).toUpperCase()}</p><h1 className="mt-20 text-6xl font-black tracking-[-.1em]">{store.name}</h1></div><div className="flex items-end justify-between gap-6"><p className="max-w-md text-sm leading-6">{store.description}</p><Link className="text-xs font-bold underline" href="/shop">ALL SHOP</Link></div></div><ProductRail eyebrow="STORE / LIVE DATABASE" title={`${store.name}의 선택`} products={products} href="/shop" /></div>;
}
