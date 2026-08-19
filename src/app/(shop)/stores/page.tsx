import type { Metadata } from "next";
import { StoreMallGrid } from "@/components/features/catalog/StoreMallGrid";
import { fetchStoreMallCards } from "@/services/stores";

export const metadata: Metadata = {
  title: "센터몰 | NINETY-NINE VINTAGE",
  description: "판매 센터별 상품과 센터 소식을 한곳에서 확인하세요.",
};

export default async function StoresPage() {
  const cards = await fetchStoreMallCards();
  return (
    <div className="space-y-10">
      <header className="border-b border-line pb-8">
        <p className="eyebrow text-muted">NINETY-NINE CENTER MALL</p>
        <h1 className="mt-3 text-4xl font-black tracking-[-0.07em]">센터몰</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">좋아하는 판매 센터를 선택해 센터별 경매와 즉시구매 상품을 둘러보세요.</p>
      </header>
      {cards.length ? <StoreMallGrid cards={cards} /> : <div className="border border-dashed border-line py-20 text-center text-sm text-muted">현재 운영 중인 센터몰이 없습니다.</div>}
    </div>
  );
}
