"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface RevenuePoint { date: string; amount: number; previousAmount: number }
interface VaultPoint { date: string; stored: number; shipped: number }

export function OwnerBusinessAnalytics({ revenue, auction, vaultFlow }: { revenue: RevenuePoint[]; auction: { sold: number; unsold: number }; vaultFlow: VaultPoint[] }) {
  const auctionData = [{ name: "경매 결과", 낙찰: auction.sold, 유찰: auction.unsold }];
  return <section className="space-y-4" aria-labelledby="owner-analytics-title">
    <div><p className="eyebrow text-muted">Business analytics</p><h2 className="mt-2 text-xl font-black" id="owner-analytics-title">운영 분석</h2></div>
    <div className="grid gap-4 xl:grid-cols-3">
      <article className="min-w-0 border border-line bg-surface p-4"><h3 className="text-xs font-black">최근 14일 GMV · 이전 기간 비교</h3><div className="mt-4 h-64" aria-label="최근 14일 결제 매출 영역 차트"><ResponsiveContainer height="100%" width="100%"><AreaChart data={revenue} margin={{ left: 4, right: 12, top: 10 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" fontSize={10} tickLine={false} /><YAxis fontSize={10} tickFormatter={(value) => `${Math.round(Number(value) / 10_000)}만`} tickLine={false} width={42} /><Tooltip formatter={(value) => `${Number(value).toLocaleString("ko-KR")}원`} /><Area dataKey="previousAmount" fill="#71717a22" name="이전 기간" stroke="#71717a" type="monotone" /><Area dataKey="amount" fill="#10b98133" name="현재 GMV" stroke="#10b981" strokeWidth={2} type="monotone" /></AreaChart></ResponsiveContainer></div></article>
      <article className="min-w-0 border border-line bg-surface p-4"><h3 className="text-xs font-black">경매 낙찰률·유찰률</h3><div className="mt-4 h-64" aria-label="경매 낙찰 및 유찰 건수 막대 차트"><ResponsiveContainer height="100%" width="100%"><BarChart data={auctionData} margin={{ left: 0, right: 8, top: 10 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={10} tickLine={false} /><YAxis allowDecimals={false} fontSize={10} tickLine={false} width={28} /><Tooltip /><Bar dataKey="낙찰" fill="#059669" radius={[4, 4, 0, 0]} /><Bar dataKey="유찰" fill="#d97706" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></article>
      <article className="min-w-0 border border-line bg-surface p-4"><h3 className="text-xs font-black">보관 시작 · 묶음 배송</h3><div className="mt-4 h-64" aria-label="보관 시작과 묶음 배송 추이"><ResponsiveContainer height="100%" width="100%"><BarChart data={vaultFlow}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" fontSize={10} /><YAxis allowDecimals={false} fontSize={10} width={28} /><Tooltip /><Bar dataKey="stored" fill="#d97706" name="보관 시작" /><Bar dataKey="shipped" fill="#059669" name="묶음 배송" /></BarChart></ResponsiveContainer></div></article>
    </div>
  </section>;
}
