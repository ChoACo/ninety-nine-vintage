"use client";

import { Area, AreaChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SalesEntry } from "./types";

const COLORS = ["#f59e0b", "#6366f1", "#10b981", "#f43f5e"];
const categoryGroup = (category: string) => /아우터|재킷|코트/i.test(category) ? "아우터" : /상의|셔츠|티/i.test(category) ? "상의" : /하의|팬츠|스커트/i.test(category) ? "하의" : "잡화";
const compactKRW = (value: number) => value >= 10_000 ? `${Math.round(value / 10_000)}만` : value.toLocaleString("ko-KR");

export function SalesChartsDeck({ entries }: { entries: SalesEntry[] }) {
  const paid = entries.filter((entry) => entry.entryKind === "item_payment" && entry.amount > 0);
  const dailyMap = new Map<string, { date: string; auction: number; shop: number }>();
  const categoryMap = new Map<string, number>();
  for (const entry of paid) {
    const date = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(entry.occurredAt));
    const point = dailyMap.get(date) ?? { date, auction: 0, shop: 0 };
    point[entry.saleType] += entry.amount;
    dailyMap.set(date, point);
    const category = categoryGroup(entry.productCategory);
    categoryMap.set(category, (categoryMap.get(category) ?? 0) + entry.amount);
  }
  const daily = [...dailyMap.values()];
  const composition = ["아우터", "상의", "하의", "잡화"].map((name) => ({ name, value: categoryMap.get(name) ?? 0 }));
  const tooltipStyle = { background: "#18181b", border: "1px solid #27272a", borderRadius: 12, color: "#e4e4e7", fontSize: 12 };
  return <section aria-label="매출 차트" className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
    <article className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <div><h2 className="font-bold text-zinc-100">일별 매출 추이</h2><p className="mt-1 text-xs text-zinc-500">라이브 옥션과 아카이브 숍 결제액 비교</p></div>
      <div className="mt-5 h-48 touch-pan-y md:h-80"><ResponsiveContainer height="100%" width="100%"><AreaChart accessibilityLayer data={daily}>
        <defs><linearGradient id="auctionFill" x1="0" x2="0" y1="0" y2="1"><stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} /><stop offset="95%" stopColor="#f59e0b" stopOpacity={0} /></linearGradient><linearGradient id="shopFill" x1="0" x2="0" y1="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} /><stop offset="95%" stopColor="#6366f1" stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" fontSize={12} stroke="#71717a" tickLine={false} /><YAxis fontSize={12} stroke="#71717a" tickFormatter={compactKRW} tickLine={false} width={48} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(245,158,11,.08)" }} formatter={(value) => `₩${Number(value).toLocaleString("ko-KR")}`} /><Legend wrapperStyle={{ fontSize: 12 }} />
        <Area dataKey="auction" fill="url(#auctionFill)" name="라이브 옥션" stroke="#f59e0b" strokeWidth={2} /><Area dataKey="shop" fill="url(#shopFill)" name="아카이브 숍" stroke="#6366f1" strokeWidth={2} />
      </AreaChart></ResponsiveContainer></div>
    </article>
    <article className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5"><h2 className="font-bold text-zinc-100">카테고리 매출 구성</h2><p className="mt-1 text-xs text-zinc-500">선택 기간 빈티지 분류별 결제액</p><div className="mt-5 h-48 touch-pan-y md:h-80"><ResponsiveContainer height="100%" width="100%"><PieChart accessibilityLayer><Pie cx="50%" cy="46%" data={composition} dataKey="value" innerRadius="46%" nameKey="name" outerRadius="72%" paddingAngle={3}>{composition.map((item, index) => <Cell fill={COLORS[index]} key={item.name} />)}</Pie><Tooltip contentStyle={tooltipStyle} formatter={(value) => `₩${Number(value).toLocaleString("ko-KR")}`} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} /></PieChart></ResponsiveContainer></div></article>
  </section>;
}
