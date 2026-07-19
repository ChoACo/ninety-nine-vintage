import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductRail } from "@/components/features/catalog/ProductRail";
import { DEMO_PRODUCTS, getDemoStore } from "@/lib/catalog";

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = getDemoStore(slug);
  if (!store) notFound();
  const products = DEMO_PRODUCTS.filter((product) => product.store.id === store.id);
  return <div><div className="flex min-h-[360px] flex-col justify-between p-8 md:p-14" style={{ backgroundColor: store.accent }}><div><p className="eyebrow">CURATED STORE / {store.operator}</p><h1 className="mt-20 text-6xl font-black tracking-[-.1em]">{store.name}</h1></div><div className="flex items-end justify-between gap-6"><p className="max-w-md text-sm leading-6">{store.description}</p><Link className="text-xs font-bold underline" href="/shop">ALL SHOP</Link></div></div><ProductRail eyebrow="STORE EDIT" title={`${store.name}의 선택`} products={products} href="/shop" /></div>;
}

