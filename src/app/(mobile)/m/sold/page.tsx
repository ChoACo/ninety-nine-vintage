import type { Metadata } from "next";
import { SoldArchiveView } from "@/components/features/sold/SoldArchiveView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "판매 완료", alternates: { canonical: "/sold" } };
export default async function MobileSoldPage({ searchParams }: { searchParams: Promise<{ before?: string; beforeId?: string }> }) { const query = await searchParams; return <SoldArchiveView before={query.before} beforeId={query.beforeId} rootPath="/m" surface="mobile" />; }
