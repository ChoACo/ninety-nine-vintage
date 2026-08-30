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

export default async function MobileSoldDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const product = await loadSoldProductForSeo(id).catch(() => null);
  if (!product) notFound();
  const priceLabel = product.sale_type === "fixed" ? "판매가" : "낙찰가";
  const measurements = measurementEntries(product.measurements);
  const brandLabel = buildBrandSearchLabel(product.brand);
  const jsonLd = buildProductJsonLd(seoInput(product));
  return <article><script dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} type="application/ld+json" /><header className="border-b border-ink pb-6"><p className="eyebrow text-muted">판매 기록 / 판매 완료</p><p className="mt-4 text-xs font-bold text-muted">{brandLabel} · {product.category}</p><h1 className="mt-2 text-3xl font-black tracking-[-.08em]">{product.title}</h1></header><div className="mt-6 space-y-3">{product.image_urls.map((image, index) => <div className="relative aspect-[4/5] overflow-hidden bg-surface" key={image}><CatalogImage alt={`${brandLabel} ${product.title} ${index + 1}`} className="h-full w-full object-cover" src={image} /></div>)}</div><dl className="mt-6 divide-y divide-line border-y border-line text-sm"><div className="flex justify-between py-5"><dt className="text-muted">{priceLabel}</dt><dd className="font-mono text-xl font-bold">{product.winning_amount.toLocaleString("ko-KR")}원</dd></div><div className="flex justify-between py-4"><dt className="text-muted">상태 등급</dt><dd className="flex items-center gap-1 font-bold"><BadgeCheck size={14} /> {product.condition_grade}</dd></div></dl>{measurements.length > 0 && <section className="mt-6 border-y border-line"><h2 className="flex items-center gap-2 border-b border-line py-4 text-xs font-bold"><Ruler size={14} /> 실측 사이즈</h2>{measurements.map((measurement) => <div className="flex justify-between border-b border-line py-3 text-xs last:border-b-0" key={measurement.label}><span className="text-muted">{measurement.label}</span><span className="font-mono">{measurement.value}cm</span></div>)}</section>}<p className="mt-6 whitespace-pre-line text-sm leading-6 text-muted">{product.description}</p></article>;
}
