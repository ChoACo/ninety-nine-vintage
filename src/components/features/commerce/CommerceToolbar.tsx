"use client";

import Link from "next/link";
import { Heart, ShoppingBag } from "lucide-react";
import { useEffect } from "react";
import { useCommerceStore } from "@/store/useCommerceStore";

export function CommerceToolbar() {
  const hydrate = useCommerceStore((state) => state.hydrate);
  const likedCount = useCommerceStore((state) => state.likedIds.length);
  const cartCount = useCommerceStore((state) => state.cartIds.length);
  useEffect(() => hydrate(), [hydrate]);
  return <div className="flex items-center gap-2"><Link className="relative grid size-10 place-items-center border border-line" href="/account#likes"><Heart size={16} /><span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-ink text-[9px] text-paper">{likedCount}</span></Link><Link className="relative grid size-10 place-items-center border border-line" href="/cart"><ShoppingBag size={16} /><span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-ink text-[9px] text-paper">{cartCount}</span></Link></div>;
}

