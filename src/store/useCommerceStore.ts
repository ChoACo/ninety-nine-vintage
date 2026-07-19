"use client";

import { create } from "zustand";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface CommerceState {
  hydrated: boolean;
  syncing: boolean;
  serverInitialized: boolean;
  likedIds: string[];
  cartIds: string[];
  hydrate: () => void;
  refreshLocal: () => void;
  syncWithServer: () => Promise<void>;
  toggleLike: (id: string) => void;
  addToCart: (id: string) => void;
  removeFromCart: (id: string) => void;
  clearCart: () => void;
  replaceCart: (ids: string[]) => void;
}

const KEY = "ninetynine-commerce-cache";
const save = (likedIds: string[], cartIds: string[]) => {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify({ likedIds, cartIds }));
};

export const useCommerceStore = create<CommerceState>((set, get) => ({
  hydrated: false, syncing: false, serverInitialized: false, likedIds: [], cartIds: [],
  hydrate: () => {
    if (get().hydrated || typeof window === "undefined") return;
    try {
      const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as { likedIds?: string[]; cartIds?: string[] };
      set({ hydrated: true, likedIds: raw.likedIds ?? [], cartIds: raw.cartIds ?? [] });
    } catch { set({ hydrated: true }); }
  },
  refreshLocal: () => {
    if (typeof window === "undefined") return;
    try {
      const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as { likedIds?: string[]; cartIds?: string[] };
      set({ hydrated: true, likedIds: raw.likedIds ?? [], cartIds: raw.cartIds ?? [] });
    } catch { set({ hydrated: true }); }
  },
  syncWithServer: async () => {
    if (get().syncing) return;
    set({ syncing: true });
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        set({ serverInitialized: false, cartIds: [], likedIds: [] });
        save([], []);
        return;
      }
      const headers = { Authorization: `Bearer ${token}` };
      const [cartResponse, wishlistResponse] = await Promise.all([
        fetch("/api/cart", { headers, cache: "no-store" }),
        fetch("/api/wishlist", { headers, cache: "no-store" }),
      ]);
      if (!cartResponse.ok || !wishlistResponse.ok) {
        set({ serverInitialized: false, cartIds: [], likedIds: [] });
        save([], []);
        return;
      }
      const cartPayload = await cartResponse.json() as { productIds?: string[] };
      const wishlistPayload = await wishlistResponse.json() as { productIds?: string[] };
      const local = get();
      const serverCartIds = cartPayload.productIds ?? [];
      const serverLikedIds = wishlistPayload.productIds ?? [];
      const cartIds = local.serverInitialized ? serverCartIds : [...new Set([...serverCartIds, ...local.cartIds])];
      const likedIds = local.serverInitialized ? serverLikedIds : [...new Set([...serverLikedIds, ...local.likedIds])];
      set({ cartIds, likedIds, hydrated: true, serverInitialized: true });
      save(likedIds, cartIds);
      if (local.serverInitialized) return;
      await Promise.all([
        ...local.cartIds.filter((id) => !serverCartIds.includes(id)).map((productId) => fetch("/api/cart", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ productId }),
        }).catch(() => undefined)),
        ...local.likedIds.filter((id) => !serverLikedIds.includes(id)).map((productId) => fetch("/api/wishlist", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ productId }),
        }).catch(() => undefined)),
      ]);
    } finally {
      set({ syncing: false });
    }
  },
  toggleLike: (id) => {
    const likedIds = get().likedIds.includes(id) ? get().likedIds.filter((value) => value !== id) : [...get().likedIds, id];
    set({ likedIds }); save(likedIds, get().cartIds);
  },
  addToCart: (id) => {
    const cartIds = get().cartIds.includes(id) ? get().cartIds : [...get().cartIds, id];
    set({ cartIds }); save(get().likedIds, cartIds);
  },
  removeFromCart: (id) => {
    const cartIds = get().cartIds.filter((value) => value !== id);
    set({ cartIds }); save(get().likedIds, cartIds);
  },
  clearCart: () => { set({ cartIds: [] }); save(get().likedIds, []); },
  replaceCart: (ids) => { const cartIds = [...new Set(ids)]; set({ cartIds }); save(get().likedIds, cartIds); },
}));
