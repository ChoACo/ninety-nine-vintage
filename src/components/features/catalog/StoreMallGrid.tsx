import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { SectionHeading } from "@/components/ui/SectionHeading";
import { CatalogImage } from "@/components/ui/CatalogImage";
import type { StoreMallCard } from "@/services/stores";

const CARD_SURFACES = [
  "var(--store-card-1)",
  "var(--store-card-2)",
  "var(--store-card-3)",
] as const;

export function StoreMallGrid({
  basePath = "",
  cards,
}: {
  basePath?: "" | "/m";
  cards: StoreMallCard[];
}) {
  if (cards.length === 0) return null;
  return (
    <section aria-label="판매 센터몰 바로가기">
      <SectionHeading
        className="mb-6"
        eyebrow="판매 센터몰"
        title="센터몰 바로가기"
        titleClassName="mt-2 text-2xl font-black tracking-[-0.06em]"
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4 lg:gap-5">
        {cards.map((card, index) => {
          const mallInfo = card.mallInfo ?? "공식 판매 센터몰";
          const image = card.bannerUrl ?? card.mallImage;
          const hasImage = Boolean(image);
          return (
            <div className="relative aspect-[16/10]" key={card.id}>
              <Link
                aria-label={`${card.name} 센터몰 열기`}
                className="group absolute inset-0 overflow-hidden rounded-2xl border border-line transition-[inset,box-shadow,border-color] duration-300 ease-out hover:-inset-2 hover:z-10 hover:border-ink hover:shadow-[var(--theme-lift-shadow)]"
                href={`${basePath}/stores/${encodeURIComponent(card.slug)}`}
                prefetch={false}
                style={
                  hasImage
                    ? undefined
                    : {
                        background: CARD_SURFACES[index % CARD_SURFACES.length],
                      }
                }
              >
                {hasImage && (
                  <>
                    <CatalogImage
                      alt={`${card.name} 센터 배너`}
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
                      height={500}
                      src={image}
                      width={800}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/5" />
                  </>
                )}
                <div className="relative flex h-full flex-col justify-between p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p
                        className={`eyebrow ${hasImage ? "text-zinc-300" : "text-muted"}`}
                      >
                        {card.liveAuctionCount
                          ? "LIVE 경매 진행중"
                          : "판매 센터몰"}
                      </p>
                      <div className="mt-2 flex min-w-0 items-center gap-2">
                        <div
                          className={`grid size-11 shrink-0 place-items-center overflow-hidden rounded-full border ${hasImage ? "border-white/30 bg-black/35" : "border-line bg-paper"}`}
                        >
                          {card.logoUrl ? (
                            <CatalogImage
                              alt={`${card.name} 로고`}
                              className="h-full w-full object-cover"
                              height={44}
                              src={card.logoUrl}
                              width={44}
                            />
                          ) : (
                            <span className="text-sm font-black">
                              {card.name.slice(0, 1)}
                            </span>
                          )}
                        </div>
                        <h3
                          className={`truncate text-base font-black tracking-[-.04em] ${hasImage ? "text-paper" : ""}`}
                        >
                          {card.name}
                        </h3>
                      </div>
                    </div>
                    <ArrowUpRight
                      className={`shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 ${hasImage ? "text-paper" : ""}`}
                      size={18}
                    />
                  </div>
                  <div>
                    <div className="flex gap-1.5">
                      {card.conceptTags.slice(0, 2).map((tag) => (
                        <span
                          className={`rounded-full px-2 py-1 text-[10px] font-bold ${hasImage ? "bg-black/35 text-zinc-100" : "bg-paper text-muted"}`}
                          key={tag}
                        >
                          #{tag.replace(/^#/u, "")}
                        </span>
                      ))}
                    </div>
                    <p
                      className={`mt-2 truncate text-[11px] font-bold ${hasImage ? "text-zinc-100" : "text-muted"}`}
                    >
                      {mallInfo}
                    </p>
                    <div
                      className={`mt-2 flex items-center justify-between border-t pt-2 text-[10px] font-bold ${hasImage ? "border-white/20 text-zinc-300" : "border-line text-muted"}`}
                    >
                      <span>★ 후기 준비중</span>
                      <span className="font-mono">
                        상품 {card.totalCount.toLocaleString("ko-KR")}개
                      </span>
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
