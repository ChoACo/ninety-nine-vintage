"use client";

import Link from "next/link";
import { Database, PackagePlus, ShieldCheck, Store, Truck } from "lucide-react";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { OwnerSiteStatusPanel } from "@/components/admin/owner/OwnerSiteStatusPanel";

interface StoreRow { id: string; slug: string; name: string; description: string; operator_id: string; }
interface ProductRow { id: string; title: string; status: string; sale_type: string; current_price: number; store_id: string | null; }
interface Overview { stores?: StoreRow[]; products?: ProductRow[]; orders?: Array<{ id: string; status: string; total: number }>; auditCount?: number; }

export function OwnerDashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => { void (async () => { try { const session = (await getSupabaseBrowserClient().auth.getSession()).data.session; if (!session) { setNotice("소유자 계정으로 로그인해 주세요."); return; } const response = await fetch("/api/admin/owner/overview", { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" }); const payload = await response.json() as Overview & { error?: string }; if (!response.ok) throw new Error(payload.error ?? "소유자 데이터를 불러오지 못했습니다."); setData(payload); } catch (error) { setNotice(error instanceof Error ? error.message : "소유자 데이터를 불러오지 못했습니다."); } })(); }, []);
  const stores = data?.stores ?? [];
  const products = data?.products ?? [];
  const orders = data?.orders ?? [];
  const paidTotal = orders.filter((order) => order.status === "paid" || order.status === "shipped").reduce((sum, order) => sum + Number(order.total), 0);
  return <div className="space-y-10"><div className="flex flex-col items-start justify-between gap-5 border-b border-ink pb-7  "><div><p className="eyebrow text-muted">OWNER / ALL STORES</p><h1 className="mt-3 text-4xl font-black tracking-[-.08em]">소유자 센터</h1><p className="mt-3 text-sm text-muted">모든 숍과 운영 데이터를 한 곳에서 확인합니다.</p></div><span className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-bold text-emerald-800"><ShieldCheck size={13} /> OWNER ACCESS</span></div>{notice && <div className="border border-dashed border-line bg-surface p-6 text-sm">{notice}</div>}<div className="grid gap-px border border-line bg-line "><div className="bg-paper p-6"><Store size={17} /><p className="mt-8 text-xs text-muted">운영 중인 숍</p><p className="mt-2 font-mono text-3xl font-bold">{stores.length}</p></div><div className="bg-paper p-6"><Database size={17} /><p className="mt-8 text-xs text-muted">결제 완료 거래</p><p className="mt-2 font-mono text-3xl font-bold">{paidTotal.toLocaleString("ko-KR")}원</p></div><div className="bg-ink p-6 text-paper"><p className="eyebrow text-zinc-400">AUDIT / EVENTS</p><p className="mt-8 font-mono text-3xl font-bold">{data?.auditCount ?? 0}</p><p className="mt-2 text-xs text-zinc-400">감사 로그</p></div></div><OwnerSiteStatusPanel /><div className="grid gap-3 "><Link className="flex items-center gap-3 border border-ink p-5 text-sm font-bold" href="/admin/owner/products"><PackagePlus size={18} /> 상품 등록·수정·일괄등록</Link><Link className="flex items-center gap-3 border border-ink p-5 text-sm font-bold" href="/admin/owner/operations"><Truck size={18} /> 배송 대기·결제 현황</Link></div><section><div className="mb-4 border-b border-ink pb-4"><p className="eyebrow text-muted">STORE OPERATORS</p><h2 className="mt-2 text-xl font-black">숍별 운영 현황</h2></div><div className="grid gap-3 ">{stores.map((store, index) => <Link className="border border-line p-5 transition-transform hover:-translate-y-1" href={`/stores/${store.slug}`} key={store.id} style={{ borderTopColor: ["#c7b9a5", "#9fa9a2", "#b8a7a1"][index % 3], borderTopWidth: 4 }}><p className="text-xs font-bold">{store.name}</p><p className="mt-2 text-[11px] text-muted">운영자 {store.operator_id.slice(0, 8)}</p><div className="mt-8 flex items-end justify-between"><span className="font-mono text-2xl font-bold">{products.filter((product) => product.store_id === store.id).length}<small className="ml-1 text-xs font-sans font-normal text-muted">items</small></span></div></Link>)}{stores.length === 0 && <div className="col-span-full border border-dashed border-line py-12 text-center text-sm text-muted">등록된 숍이 없습니다.</div>}</div></section></div>;
}
