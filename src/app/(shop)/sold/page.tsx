import type { Metadata } from "next";
import { SoldArchiveView } from "@/components/features/sold/SoldArchiveView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "판매 완료 아카이브 | NINETY-NINE VINTAGE",
  description: "다시 만날 수 없는 빈티지 상품의 판매 기록과 브랜드별 아카이브를 확인하세요.",
  alternates: { canonical: "/sold" },
  openGraph: { title: "판매 완료 아카이브 | NINETY-NINE VINTAGE", description: "브랜드별 빈티지 판매 기록", url: "/sold", type: "website" },
};

export default async function SoldPage({ searchParams }: { searchParams: Promise<{ before?: string; beforeId?: string }> }) {
  const query = await searchParams;
  return <SoldArchiveView before={query.before} beforeId={query.beforeId} />;
}
