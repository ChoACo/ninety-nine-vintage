import { CircleDollarSign, Gavel, ShoppingBag, WalletCards } from "lucide-react";
import type { SalesMetrics } from "./types";

const money = (value: number) => `₩${Math.round(value).toLocaleString("ko-KR")}`;

export function SalesMetricCards({ metrics }: { metrics: SalesMetrics }) {
  const change = metrics.previousGross > 0 ? ((metrics.gross - metrics.previousGross) / metrics.previousGross) * 100 : null;
  const cards = [
    { label: "총 결제 매출액", value: money(metrics.gross), icon: CircleDollarSign, color: "text-zinc-100", sub: change === null ? "비교 기간 매출 없음" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}% vs 지난 기간`, badge: change !== null },
    { label: "라이브 옥션 매출", value: money(metrics.auctionGross), icon: Gavel, color: "text-amber-400", sub: `총 ${metrics.auctionCount}건 낙찰 완료 · 평균 ${money(metrics.auctionCount ? metrics.auctionGross / metrics.auctionCount : 0)}` },
    { label: "아카이브 숍 매출", value: money(metrics.shopGross), icon: ShoppingBag, color: "text-indigo-400", sub: `총 ${metrics.shopCount}건 즉시 구매 · 평균 ${money(metrics.shopCount ? metrics.shopGross / metrics.shopCount : 0)}` },
    { label: "실 정산 예정액", value: money(metrics.payout), icon: WalletCards, color: "text-emerald-400", sub: `수수료 ${money(metrics.commission)} 공제 후${metrics.nextSettlementDate ? ` · ${metrics.nextSettlementDate} 예정` : ""}` },
  ];
  return <section aria-label="매출 핵심 지표" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{cards.map((card) => <article className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-sm" key={card.label}><div className="flex items-center justify-between"><p className="text-xs font-bold text-zinc-400">{card.label}</p><card.icon className={card.color} size={18} strokeWidth={1.75} /></div><p className={`mt-5 font-mono text-2xl font-bold tracking-tight ${card.color}`}>{card.value}</p><p className={`mt-3 text-xs leading-5 ${card.badge ? "inline-flex rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-400" : "text-zinc-500"}`}>{card.sub}</p></article>)}</section>;
}
