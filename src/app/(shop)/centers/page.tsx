import type { Metadata } from "next";
import { CenterMallHub } from "@/components/features/catalog/CenterMallHub";
import { fetchStoreMallCards } from "@/services/stores";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "센터몰 | NINETY-NINE VINTAGE", description: "취향과 콘셉트로 판매 센터를 찾고 센터별 경매와 상품을 만나보세요.", alternates: { canonical: "/centers" } };
export default async function CentersPage() { const cards = await fetchStoreMallCards(); return <div className="space-y-10"><header className="rounded-3xl bg-zinc-950 px-6 py-12 text-zinc-100 md:px-10"><p className="text-[10px] font-black tracking-[.18em] text-amber-500">NINETY-NINE CENTER MALL</p><h1 className="mt-4 text-4xl font-black tracking-[-.07em] md:text-6xl">취향이 모이는 센터몰</h1><p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-400">각자의 무드와 셀렉션을 가진 판매 센터를 발견하고 단 한 점의 빈티지를 만나보세요.</p></header><CenterMallHub cards={cards} /></div>; }
