import type { Metadata } from "next";
import { SoldArchiveView } from "@/components/features/sold/SoldArchiveView";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> { const { slug } = await params; return { title: "브랜드 판매 기록", alternates: { canonical: `/sold/brand/${encodeURIComponent(slug)}` } }; }
export default async function MobileSoldBrandPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ before?: string; beforeId?: string }> }) { const [{ slug }, query] = await Promise.all([params, searchParams]); return <SoldArchiveView before={query.before} beforeId={query.beforeId} brandSlug={slug} rootPath="/m" surface="mobile" />; }
