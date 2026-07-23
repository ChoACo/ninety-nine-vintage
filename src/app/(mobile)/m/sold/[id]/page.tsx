import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgeCheck, Ruler } from "lucide-react";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { fetchSoldProduct } from "@/services/sold";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const measurementLabels: Record<string, string> = { shoulder: "어깨", chest: "가슴", sleeve: "소매", length: "총장" };
export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> { const { id } = await params; return { title: "판매 기록", alternates: { canonical: `/sold/${id}` } }; }
export default async function MobileSoldDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const product = await fetchSoldProduct(id).catch(() => null);
  if (!product) notFound();
  const record = product.measurements && typeof product.measurements === "object" && !Array.isArray(product.measurements) ? product.measurements as Record<string, unknown> : {};
  const measurements = Object.entries(measurementLabels).flatMap(([key, label]) => { const value = Number(record[key]); return Number.isFinite(value) && value > 0 ? [{ label, value }] : []; });
  return <article><header className="border-b border-ink pb-6"><p className="eyebrow text-muted">판매 기록 / 판매 완료</p><p className="mt-4 text-xs font-bold text-muted">{product.brand} · {product.category}</p><h1 className="mt-2 text-3xl font-black tracking-[-.08em]">{product.title}</h1></header><div className="mt-6 space-y-3">{product.image_urls.map((image, index) => <div className="relative aspect-[4/5] overflow-hidden bg-surface" key={image}><CatalogImage alt={`${product.title} ${index + 1}`} className="h-full w-full object-cover" src={image} /></div>)}</div><dl className="mt-6 divide-y divide-line border-y border-line text-sm"><div className="flex justify-between py-5"><dt className="text-muted">낙찰가</dt><dd className="font-mono text-xl font-bold">{product.winning_amount.toLocaleString("ko-KR")}원</dd></div><div className="flex justify-between py-4"><dt className="text-muted">상태 등급</dt><dd className="flex items-center gap-1 font-bold"><BadgeCheck size={14} /> {product.condition_grade}</dd></div></dl>{measurements.length > 0 && <section className="mt-6 border-y border-line"><h2 className="flex items-center gap-2 border-b border-line py-4 text-xs font-bold"><Ruler size={14} /> 실측 사이즈</h2>{measurements.map((measurement) => <div className="flex justify-between border-b border-line py-3 text-xs last:border-b-0" key={measurement.label}><span className="text-muted">{measurement.label}</span><span className="font-mono">{measurement.value}cm</span></div>)}</section>}<p className="mt-6 whitespace-pre-line text-sm leading-6 text-muted">{product.description}</p></article>;
}
