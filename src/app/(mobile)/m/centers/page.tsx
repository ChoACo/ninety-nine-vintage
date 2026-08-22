import { CenterMallHub } from "@/components/features/catalog/CenterMallHub";
import { fetchStoreMallCards } from "@/services/stores";
export const dynamic = "force-dynamic";
export default async function MobileCentersPage() { return <div className="space-y-7"><header><p className="text-[9px] font-black tracking-[.18em] text-amber-500">CENTER MALL</p><h1 className="mt-3 text-3xl font-black tracking-[-.07em]">취향이 모이는 센터몰</h1></header><CenterMallHub cards={await fetchStoreMallCards()} routeBase="/m/centers" /></div>; }
