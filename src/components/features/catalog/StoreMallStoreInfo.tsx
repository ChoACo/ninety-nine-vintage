import { ArrowRight, Gavel, MessageCircle, ShoppingBag } from "lucide-react";
import Link from "next/link";

import { StoreMallTabs } from "@/components/features/catalog/StoreMallTabs";
import { CatalogImage } from "@/components/ui/CatalogImage";
import type { PublicStore } from "@/services/stores";

export function StoreMallStoreInfo({ basePath = "", slug, store, surface }: { basePath?: "" | "/m"; slug: string; store: PublicStore; surface: "desktop" | "mobile" }) {
  const isDesktop = surface === "desktop";
  const chatHref = `${basePath}/chat?storeId=${store.id}`;
  return <div className={isDesktop ? "pb-24" : "pb-8"}>
    <StoreMallTabs active="about" basePath={basePath} chatHref={chatHref} slug={slug} surface={surface} />
    <section className={`mt-10 overflow-hidden border border-line ${isDesktop ? "grid grid-cols-2" : ""}`} id="store-story">
      <div className={`${isDesktop ? "p-10" : "p-6"} bg-[var(--store-card-1)]`}>
        <p className="eyebrow">ABOUT THE CENTER</p>
        <h1 className="mt-3 text-3xl font-black tracking-[-.07em]">{store.name}</h1>
        <p className="mt-6 text-sm leading-7">{store.description}</p>
        <p className="mt-5 text-xs leading-5 text-muted">상품 검수·판매·배송·문의는 이 판매 센터가 직접 담당합니다.</p>
        {store.mallImage ? <div className="mt-8"><CatalogImage alt={store.name} className="aspect-[4/3] w-full object-cover" maxDimension={800} sizes={isDesktop ? "400px" : "100vw"} src={store.mallImage} /></div> : null}
      </div>
      <div className={`${isDesktop ? "p-10" : "p-6"} bg-surface`}>
        <p className="eyebrow text-muted">SHOPPING GUIDE</p>
        <div className="mt-6 grid gap-4">{[{ icon: Gavel, title: "경매", copy: "선택한 등록일의 진행 상품에 입찰합니다." }, { icon: ShoppingBag, title: "즉시구매", copy: "판매 중인 상품을 바로 주문합니다." }, { icon: MessageCircle, title: "센터 문의", copy: "상품·배송 질문을 판매 센터에 바로 남깁니다." }].map(({ icon: Icon, title, copy }) => <div className="flex gap-4 border-b border-line pb-4" key={title}><Icon className="shrink-0" size={19} /><div><p className="text-sm font-black">{title}</p><p className="mt-1 text-xs text-muted">{copy}</p></div></div>)}</div>
        <Link className="mt-7 inline-flex min-h-12 w-full items-center justify-center gap-2 bg-ink px-5 text-xs font-black text-paper" href={chatHref}>이 센터에 문의하기 <ArrowRight size={15} /></Link>
      </div>
    </section>
  </div>;
}