import type { Metadata } from "next";
import { StoreMallGrid } from "@/components/features/catalog/StoreMallGrid";
import { fetchStoreMallCards } from "@/services/stores";

export const metadata: Metadata = {
  title: "센터몰",
  description: "판매 센터별 상품을 둘러보세요.",
};

export default async function MobileStoresPage() {
  const cards = await fetchStoreMallCards();
  return (
    <div className="space-y-8">
      <header className="border-b border-line pb-6">
        <p className="eyebrow text-muted">CENTER MALL</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.07em]">센터몰</h1>
        <p className="mt-2 text-xs leading-5 text-muted">센터를 선택하면 해당 센터의 경매·즉시구매 상품을 확인할 수 있습니다.</p>
      </header>
      {cards.length ? <StoreMallGrid basePath="/m" cards={cards} /> : <div className="border border-dashed border-line py-16 text-center text-sm text-muted">현재 운영 중인 센터몰이 없습니다.</div>}
    </div>
  );
}
