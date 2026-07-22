import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgeCheck, Ruler } from "lucide-react";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { fetchSoldProduct } from "@/services/sold";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const measurementLabels: Record<string, string> = { shoulder: "어깨", chest: "가슴", sleeve: "소매", length: "총장" };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return {};
  const product = await fetchSoldProduct(id).catch(() => null);
  if (!product) return {};
  const title = `${product.title} 판매 기록 | NINETY-NINE VINTAGE`;
  const description = `${product.brand} ${product.title}의 빈티지 판매 기록과 낙찰가를 확인하세요.`;
  const url = `/sold/${id}`;
  const images = product.image_urls[0] ? [{ url: product.image_urls[0], alt: product.title }] : undefined;
  return { title, description, alternates: { canonical: url }, openGraph: { title, description, url, type: "website", images } };
}

export default async function SoldDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const product = await fetchSoldProduct(id).catch(() => null);
  if (!product) notFound();
  const measurementRecord = product.measurements && typeof product.measurements === "object" && !Array.isArray(product.measurements) ? product.measurements as Record<string, unknown> : {};
  const measurements = Object.entries(measurementLabels).flatMap(([key, label]) => { const value = Number(measurementRecord[key]); return Number.isFinite(value) && value > 0 ? [{ label, value }] : []; });
  const jsonLd = { "@context": "https://schema.org", "@type": "Product", name: product.title, description: product.description, brand: { "@type": "Brand", name: product.brand }, category: product.category, image: product.image_urls, itemCondition: "https://schema.org/UsedCondition", offers: { "@type": "Offer", priceCurrency: "KRW", price: product.winning_amount, availability: "https://schema.org/SoldOut", url: `https://www.ninety-nine-vintage.store/sold/${product.product_id}` } };

  return <article className="space-y-8 md:space-y-10"><script dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} type="application/ld+json" /><header className="border-b border-ink pb-7"><p className="eyebrow text-muted">판매 기록 / 판매 완료</p><p className="mt-4 text-xs font-bold text-muted">{product.brand} · {product.category}</p><h1 className="mt-2 break-keep text-3xl font-black tracking-[-.08em] md:text-4xl">{product.title}</h1><p className="mt-4 max-w-3xl text-sm leading-6 text-muted">{product.description}</p></header><div className="grid gap-8 lg:grid-cols-2 lg:gap-10"><div className="space-y-3">{product.image_urls.map((image, index) => <div className="relative aspect-[4/5] overflow-hidden bg-surface" key={image}><CatalogImage alt={`${product.title} ${index + 1}`} className="h-full w-full object-cover" src={image} /></div>)}</div><aside className="self-start border-t-2 border-ink lg:sticky lg:top-28"><dl className="divide-y divide-line text-sm"><div className="flex justify-between gap-4 py-5"><dt className="text-muted">낙찰가</dt><dd className="font-mono text-xl font-bold">{product.winning_amount.toLocaleString("ko-KR")}원</dd></div><div className="flex justify-between gap-4 py-4"><dt className="text-muted">판매일</dt><dd className="text-right">{new Intl.DateTimeFormat("ko-KR", { dateStyle: "long" }).format(new Date(product.sold_at))}</dd></div><div className="flex justify-between gap-4 py-4"><dt className="text-muted">상태 등급</dt><dd className="flex items-center gap-1 font-bold"><BadgeCheck size={14} /> {product.condition_grade}</dd></div>{product.size_label && <div className="flex justify-between gap-4 py-4"><dt className="text-muted">표기 사이즈</dt><dd className="text-right">{product.size_label}</dd></div>}</dl>{measurements.length > 0 && <section className="mt-8 border-y border-line"><h2 className="flex items-center gap-2 border-b border-line py-4 text-xs font-bold"><Ruler size={14} /> 실측 사이즈</h2>{measurements.map((measurement) => <div className="flex justify-between border-b border-line py-3 text-xs last:border-b-0" key={measurement.label}><span className="text-muted">{measurement.label}</span><span className="font-mono">{measurement.value}cm</span></div>)}</section>}<section className="mt-8 bg-surface p-5"><h2 className="text-xs font-bold">상태·하자 기록</h2><ul className="mt-3 space-y-2 text-xs leading-5 text-muted">{product.inspection_notes.length > 0 ? product.inspection_notes.map((note) => <li key={note}>{note}</li>) : <li>특이사항 없음</li>}</ul></section></aside></div></article>;
}
