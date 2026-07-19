"use client";

import { useState } from "react";
import type { ItemDetail } from "@/types/detail";

interface ItemGalleryProps {
  item: ItemDetail;
}

export function ItemGallery({ item }: ItemGalleryProps) {
  const [activeImage, setActiveImage] = useState(0);

  return (
    <section className="col-span-7">
      <div className="relative aspect-[4/5] overflow-hidden bg-zinc-100">
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${item.images[activeImage]})` }} />
        <span className="absolute left-5 top-5 bg-white px-3 py-2 text-xs font-bold tracking-[0.12em] text-zinc-950">LOT #{item.id}</span>
        <span className="absolute right-5 top-5 bg-zinc-950 px-3 py-2 text-xs font-bold tracking-[0.08em] text-white">Condition {item.conditionGrade}</span>
      </div>
      <div className="mt-4 grid grid-cols-6 gap-3">
        {item.images.map((image, index) => (
          <button
            aria-label={`${item.name} 이미지 ${index + 1} 보기`}
            className={`relative aspect-square overflow-hidden bg-zinc-100 ${activeImage === index ? "ring-2 ring-zinc-950 ring-offset-2" : "opacity-60 transition-opacity hover:opacity-100"}`}
            key={image}
            onClick={() => setActiveImage(index)}
            type="button"
          >
            <span className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${image})` }} />
          </button>
        ))}
      </div>
    </section>
  );
}
