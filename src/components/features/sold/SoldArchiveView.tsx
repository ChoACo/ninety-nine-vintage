import Link from "next/link";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { fetchSoldArchivePage, fetchSoldBrands } from "@/services/sold";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function SoldArchiveView({ brandSlug, before, beforeId, rootPath = "", surface = "desktop" }: { brandSlug?: string; before?: string; beforeId?: string; rootPath?: "" | "/m"; surface?: "desktop" | "mobile" }) {
  const hasCursor = Boolean(before && Number.isFinite(Date.parse(before)) && beforeId && UUID_PATTERN.test(beforeId));
  const [archive, brands] = await Promise.all([
    fetchSoldArchivePage({ brandSlug, before: hasCursor ? before : undefined, beforeId: hasCursor ? beforeId : undefined }),
    fetchSoldBrands(),
  ]);
  const activeBrand = brandSlug ? brands.find((brand) => brand.brand_slug === brandSlug) : null;
  const nextProduct = archive.products.at(-1);
  const basePath = brandSlug ? `${rootPath}/sold/brand/${encodeURIComponent(brandSlug)}` : `${rootPath}/sold`;
  const nextHref = nextProduct ? `${basePath}?before=${encodeURIComponent(nextProduct.sold_at)}&beforeId=${nextProduct.product_id}` : "";

  return <div className={surface === "desktop" ? "space-y-10" : "space-y-8"}>
    <div className="border-b border-ink pb-7"><p className="eyebrow text-muted">판매 기록 / 판매 완료</p><h1 className={`mt-3 break-keep font-black tracking-[-.08em] ${surface === "desktop" ? "text-4xl" : "text-3xl"}`}>{activeBrand ? `${activeBrand.brand} 판매 기록` : "판매 완료 아카이브"}</h1><p className="mt-3 text-sm text-muted">다시 만날 수 없기에, 기록으로 남깁니다.</p></div>
    <nav aria-label="판매 완료 브랜드" className="flex flex-wrap gap-2"><Link aria-current={!brandSlug ? "page" : undefined} className={`border px-3 py-2 text-xs font-bold ${!brandSlug ? "border-ink bg-ink text-paper" : "border-line"}`} href={`${rootPath}/sold`}>전체</Link>{brands.map((brand) => <Link aria-current={brand.brand_slug === brandSlug ? "page" : undefined} className={`border px-3 py-2 text-xs font-bold ${brand.brand_slug === brandSlug ? "border-ink bg-ink text-paper" : "border-line"}`} href={`${rootPath}/sold/brand/${encodeURIComponent(brand.brand_slug)}`} key={brand.brand_slug}>{brand.brand} <span className="font-mono text-[10px] opacity-60">{brand.sold_count}</span></Link>)}</nav>
    {archive.products.length === 0 ? <div className="border border-dashed border-line py-20 text-center text-sm text-muted">판매 완료 상품이 없습니다.</div> : <div className={`grid grid-cols-2 gap-x-3 gap-y-7 ${surface === "desktop" ? "grid-cols-4" : "min-[700px]:grid-cols-3"}`}>{archive.products.map((product) => <article className="min-w-0" key={product.product_id}><Link aria-label={`${product.title} 판매 기록 보기`} href={`${rootPath}/sold/${product.product_id}`}><div className="relative aspect-[4/5] overflow-hidden bg-surface"><CatalogImage alt={product.title} className="h-full w-full object-cover grayscale" src={product.thumbnail_urls[0] ?? product.image_urls[0] ?? ""} /><span className="absolute left-2 top-2 bg-paper px-2 py-1 text-[9px] font-bold">판매 완료</span></div><span className="mt-3 block truncate text-[10px] font-bold text-muted">{product.brand}</span><span className="mt-1 block truncate text-xs font-bold">{product.title}</span></Link><p className="mt-1 text-[10px] text-muted">{new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(new Date(product.sold_at))} · {product.winning_amount.toLocaleString("ko-KR")}원</p></article>)}</div>}
    {archive.hasNext && nextHref && <div className="border-t border-line pt-6 text-center"><Link className="inline-flex border border-ink px-6 py-3 text-xs font-bold" href={nextHref}>다음 24개 기록</Link></div>}
  </div>;
}
