import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { SectionHeading } from "@/components/ui/SectionHeading";
import type { StoreMallCard } from "@/services/stores";

const CARD_SURFACES = ["var(--store-card-1)", "var(--store-card-2)", "var(--store-card-3)"] as const;

export function StoreMallGrid({ basePath = "", cards }: { basePath?: "" | "/m"; cards: StoreMallCard[] }) {
  if (cards.length === 0) return null;
  return (
    <section aria-label="판매 센터몰 바로가기">
      <SectionHeading className="mb-6" eyebrow="판매 센터몰" title="센터몰 바로가기" titleClassName="mt-2 text-2xl font-black tracking-[-0.06em]" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card, index) => {
          const mallInfo = card.mallInfo ?? "공식 판매 센터몰";
          const hasImage = Boolean(card.mallImage);
          return (
            <div className="relative aspect-[4/3]" key={card.id}>
              <Link
                aria-label={`${card.name} 센터몰 열기`}
                className="group absolute inset-0 overflow-hidden rounded-2xl border border-line transition-[inset,box-shadow,border-color] duration-300 ease-out hover:-inset-2 hover:z-10 hover:border-ink hover:shadow-[var(--theme-lift-shadow)]"
                href={`${basePath}/stores/${encodeURIComponent(card.slug)}`}
                prefetch={false}
                style={hasImage ? undefined : { background: CARD_SURFACES[index % CARD_SURFACES.length] }}
              >
                {hasImage && (
                  <>
                    <img alt={card.name} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]" src={card.mallImage as string} />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/5" />
                  </>
                )}
                <div className="relative flex h-full flex-col justify-between p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`eyebrow ${hasImage ? "text-zinc-300" : "text-muted"}`}>판매 센터몰</p>
                      <h3 className={`mt-2 truncate text-xl font-black tracking-[-.05em] ${hasImage ? "text-paper" : ""}`}>{card.name}</h3>
                    </div>
                    <ArrowUpRight className={`shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 ${hasImage ? "text-paper" : ""}`} size={18} />
                  </div>
                  <div>
                    <p className={`truncate text-xs font-bold ${hasImage ? "text-zinc-100" : "text-muted"}`}>{mallInfo}</p>
                    <div className={`mt-3 grid grid-cols-2 gap-2 border-t pt-3 ${hasImage ? "border-white/20" : "border-line"}`}>
                      <div>
                        <p className={`text-[10px] font-bold tracking-[.14em] ${hasImage ? "text-zinc-300" : "text-muted"}`}>최근 등록상품</p>
                        <p className={`mt-1 font-mono text-lg font-black ${hasImage ? "text-paper" : ""}`}>{card.recentCount.toLocaleString("ko-KR")}<span className={`ml-1 text-xs font-bold ${hasImage ? "text-zinc-300" : "text-muted"}`}>개</span></p>
                      </div>
                      <div>
                        <p className={`text-[10px] font-bold tracking-[.14em] ${hasImage ? "text-zinc-300" : "text-muted"}`}>총 등록상품</p>
                        <p className={`mt-1 font-mono text-lg font-black ${hasImage ? "text-paper" : ""}`}>{card.totalCount.toLocaleString("ko-KR")}<span className={`ml-1 text-xs font-bold ${hasImage ? "text-zinc-300" : "text-muted"}`}>개</span></p>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}
