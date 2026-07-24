import Link from "next/link";

import { CatalogImage } from "@/components/ui/CatalogImage";
import type { ProductSaleType } from "@/types/auction";

interface SoldFeedCardProps {
  basePath?: "" | "/m";
  brand: string;
  id: string;
  imageUrl: string;
  saleType: ProductSaleType;
  soldAt: string;
  soldPrice: number;
  surface?: "desktop" | "mobile";
  title: string;
}

export function SoldFeedCard({
  basePath = "",
  brand,
  id,
  imageUrl,
  saleType,
  soldAt,
  soldPrice,
  surface = "desktop",
  title,
}: SoldFeedCardProps) {
  return (
    <article className="group min-w-0 border-b border-line pb-5">
      <Link
        aria-label={`${title} 판매 완료 기록 보기`}
        className="block"
        href={`${basePath}/sold/${id}`}
      >
        <div className="relative aspect-[4/5] overflow-hidden rounded-2xl border border-white/10 bg-surface shadow-lg shadow-black/5">
          {imageUrl
            ? (
              <CatalogImage
                alt=""
                className="h-full w-full object-cover grayscale"
                loading="lazy"
                sizes={surface === "desktop"
                  ? "220px"
                  : "(max-width: 699px) 50vw, 33vw"}
                src={imageUrl}
              />
            )
            : (
              <div className="grid h-full place-items-center text-xs text-muted">
                이미지 준비 중
              </div>
            )}
          <span className="absolute left-2 top-2 rounded-lg bg-paper/90 px-2 py-1 text-[9px] font-bold shadow-sm backdrop-blur-md">
            판매 완료
          </span>
        </div>
        <span className="mt-3 block truncate text-[10px] text-muted">
          {brand}
        </span>
        <span className="mt-1 block truncate text-sm font-medium">{title}</span>
      </Link>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <p className="text-[10px] text-muted">
            {saleType === "auction" ? "낙찰가" : "판매가"}
          </p>
          <p className="font-mono text-sm font-bold tabular-nums">
            {soldPrice.toLocaleString("ko-KR")}원
          </p>
        </div>
        <time className="text-[10px] text-muted" dateTime={soldAt}>
          {new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(
            new Date(soldAt),
          )}
        </time>
      </div>
    </article>
  );
}
