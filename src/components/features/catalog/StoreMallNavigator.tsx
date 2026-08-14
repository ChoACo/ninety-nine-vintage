import { ArrowUpRight, Store } from "lucide-react";
import Link from "next/link";

import type { PublicStore } from "@/services/stores";

export function StoreMallNavigator({
  basePath = "",
  stores,
}: {
  basePath?: "" | "/m";
  stores: PublicStore[];
}) {
  return (
    <section className="mb-6 border border-line bg-surface p-4" aria-label="판매 센터몰 선택">
      <div className="flex items-center justify-between gap-3">
        <div><p className="eyebrow text-muted">판매 센터몰</p><h2 className="mt-1 text-base font-black">센터별 상품과 문의 보기</h2></div>
        <Store className="shrink-0" size={20} />
      </div>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {stores.map((store) => (
          <Link className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-line bg-paper px-4 text-xs font-bold hover:border-ink" href={`${basePath}/stores/${encodeURIComponent(store.slug)}`} key={store.id} prefetch={false}>
            {store.name}<ArrowUpRight size={13} />
          </Link>
        ))}
      </div>
    </section>
  );
}
