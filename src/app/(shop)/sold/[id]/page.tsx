import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgeCheck, Ruler } from "lucide-react";
import { CatalogImage } from "@/components/ui/CatalogImage";
import type { SoldProduct } from "@/services/sold";
import { measurementEntries } from "@/lib/catalog/measurements";
import {
  buildBrandSearchLabel,
  buildProductJsonLd,
  buildProductMetadata,
  serializeJsonLd,
  type ProductSeoInput,
} from "@/lib/seo/productSeo";
import { loadSoldProductForSeo } from "@/lib/seo/productLoaders.server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const dynamic = "force-dynamic";

function seoInput(product: SoldProduct): ProductSeoInput {
  return {
    id: product.product_id,
    title: product.title,
    description: product.description,
    brand: product.brand,
    category: product.category,
    canonicalPath: `/sold/${product.product_id}`,
    imageUrls: product.image_urls,
    price: product.winning_amount,
    availability: "SoldOut",
    saleKind: "sold",
    conditionGrade: product.condition_grade,
    sizeLabel: product.size_label,
  };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return {};
  const product = await loadSoldProductForSeo(id).catch(() => null);
  return product ? buildProductMetadata(seoInput(product)) : {};
}

export default async function SoldDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const product = await loadSoldProductForSeo(id).catch(() => null);
  if (!product) notFound();
  const priceLabel = product.sale_type === "fixed" ? "판매가" : "낙찰가";
  const measurements = measurementEntries(product.measurements);
  const jsonLd = buildProductJsonLd(seoInput(product));

  return <article className="space-y-10"><script dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} type="application/ld+json" /><header className="border-b border-ink pb-7"><p className="eyebrow text-muted">판매 기록 / 판매 완료</p><p className="mt-4 text-xs font-bold text-muted">{buildBrandSearchLabel(product.brand)} · {product.category}</p><h1 className="mt-2 break-keep text-4xl font-black tracking-[-.08em]">{product.title}</h1><p className="mt-4 max-w-3xl text-sm leading-6 text-muted">{product.description}</p></header><div className="grid grid-cols-2 gap-10"><div className="space-y-3">{product.image_urls.map((image, index) => <div className="relative aspect-[4/5] overflow-hidden bg-surface" key={image}><CatalogImage alt={`${buildBrandSearchLabel(product.brand)} ${product.title} ${index + 1}`} className="h-full w-full object-cover" sizes="580px" src={image} /></div>)}</div><aside className="sticky top-28 self-start border-t-2 border-ink"><dl className="divide-y divide-line text-sm"><div className="flex justify-between gap-4 py-5"><dt className="text-muted">{priceLabel}</dt><dd className="font-mono text-xl font-bold">{product.winning_amount.toLocaleString("ko-KR")}원</dd></div><div className="flex justify-between gap-4 py-4"><dt className="text-muted">판매일</dt><dd className="text-right">{new Intl.DateTimeFormat("ko-KR", { dateStyle: "long" }).format(new Date(product.sold_at))}</dd></div><div className="flex justify-between gap-4 py-4"><dt className="text-muted">상태 등급</dt><dd className="flex items-center gap-1 font-bold"><BadgeCheck size={14} /> {product.condition_grade}</dd></div>{product.size_label && <div className="flex justify-between gap-4 py-4"><dt className="text-muted">표기 사이즈</dt><dd className="text-right">{product.size_label}</dd></div>}</dl>{measurements.length > 0 && <section className="mt-8 border-y border-line"><h2 className="flex items-center gap-2 border-b border-line py-4 text-xs font-bold"><Ruler size={14} /> 실측 사이즈</h2>{measurements.map((measurement) => <div className="flex justify-between border-b border-line py-3 text-xs last:border-b-0" key={measurement.label}><span className="text-muted">{measurement.label}</span><span className="font-mono">{measurement.value}cm</span></div>)}</section>}<section className="mt-8 bg-surface p-5"><h2 className="text-xs font-bold">상태·하자 기록</h2><ul className="mt-3 space-y-2 text-xs leading-5 text-muted">{product.inspection_notes.length > 0 ? product.inspection_notes.map((note) => <li key={note}>{note}</li>) : <li>특이사항 없음</li>}</ul></section></aside></div></article>;
}
