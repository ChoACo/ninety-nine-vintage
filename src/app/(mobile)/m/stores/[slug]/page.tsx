import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductRail } from "@/components/features/catalog/ProductRail";
import { fetchStoreBySlug, fetchStoreProducts } from "@/services/stores";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> { const { slug } = await params; const store = await fetchStoreBySlug(slug).catch(() => null); return store ? { title: store.name, description: store.description.slice(0, 160), alternates: { canonical: `/stores/${encodeURIComponent(slug)}` } } : {}; }
export default async function MobileStorePage({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; const store = await fetchStoreBySlug(slug); if (!store) notFound(); const products = await fetchStoreProducts(store.id, "fixed"); return <div><section className="-mx-4 flex min-h-[300px] flex-col justify-between bg-[var(--store-card-1)] p-6"><div><p className="eyebrow">엄선된 숍 · 숍 소개</p><h1 className="mt-16 text-4xl font-black tracking-[-.08em]">{store.name}</h1></div><div><p className="max-w-md text-sm leading-6">{store.description}</p><Link className="mt-5 inline-flex text-xs font-bold underline" href="/m/shop">전체 상품 보기</Link></div></section><ProductRail basePath="/m" eyebrow="숍 · 즉시 구매" href="/m/shop" products={products} surface="mobile" title={`${store.name}의 선택`} /></div>; }
