import Link from "next/link";
import { fetchSoldArchive } from "@/services/sold";

export const dynamic = "force-dynamic";

export default async function SoldPage() {
  const products = await fetchSoldArchive().catch(() => []);
  return <div className="space-y-10"><div className="border-b border-ink pb-7"><p className="eyebrow text-muted">ARCHIVE / SOLD</p><h1 className="mt-3 text-4xl font-black tracking-[-.08em]">판매 완료 아카이브</h1><p className="mt-3 text-sm text-muted">다시 만날 수 없기에, 기록으로 남깁니다.</p></div>{products.length === 0 ? <div className="border border-dashed border-line py-20 text-center text-sm text-muted">판매 완료 상품이 없습니다.</div> : <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{products.map((product) => <article key={product.product_id}><div className="relative aspect-[4/5] overflow-hidden bg-surface"><img alt={product.title} className="h-full w-full object-cover grayscale" src={product.image_urls[0] ?? ""} /><span className="absolute left-2 top-2 bg-paper px-2 py-1 text-[9px] font-bold">SOLD</span></div><Link className="mt-3 block truncate text-xs font-bold" href={`/auction/${product.product_id}`}>{product.title}</Link><p className="mt-1 text-[10px] text-muted">{product.winner_display_name} · {product.winning_amount.toLocaleString("ko-KR")}원</p></article>)}</div>}</div>;
}
