"use client";

import { create } from "zustand";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isEntryReadOnly } from "@/lib/entryMode";

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
const readLocal = () => {
  if (typeof window === "undefined") return { likedIds: [] as string[], cartIds: [] as string[] };
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as { likedIds?: string[]; cartIds?: string[] };
    return { likedIds: raw.likedIds ?? [], cartIds: raw.cartIds ?? [] };
  } catch {
    return { likedIds: [], cartIds: [] };
  }
};

export const useCommerceStore = create<CommerceState>((set, get) => ({
  hydrated: false, syncing: false, serverInitialized: false, likedIds: [], cartIds: [],
  hydrate: () => {
    if (get().hydrated || typeof window === "undefined") return;
    const local = readLocal();
    set({ hydrated: true, likedIds: local.likedIds, cartIds: local.cartIds });
  },
  refreshLocal: () => {
    if (typeof window === "undefined" || get().serverInitialized) return;
    const local = readLocal();
    set({ hydrated: true, likedIds: local.likedIds, cartIds: local.cartIds });
  },
  syncWithServer: async () => {
    if (get().syncing) return;
    set({ syncing: true });
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        set({ serverInitialized: false });
        get().refreshLocal();
        return;
      }
      const headers = { Authorization: `Bearer ${token}` };
      const [cartResponse, wishlistResponse] = await Promise.all([
        fetch("/api/cart", { headers, cache: "no-store" }),
        fetch("/api/wishlist", { headers, cache: "no-store" }),
      ]);
      if (!cartResponse.ok || !wishlistResponse.ok) {
        set({ serverInitialized: false });
        get().refreshLocal();
        return;
      }
      const cartPayload = await cartResponse.json() as { productIds?: string[] };
      const wishlistPayload = await wishlistResponse.json() as { productIds?: string[] };
      const serverCartIds = cartPayload.productIds ?? [];
      const serverLikedIds = wishlistPayload.productIds ?? [];
      set({ cartIds: serverCartIds, likedIds: serverLikedIds, hydrated: true, serverInitialized: true });
    } catch {
      set({ serverInitialized: false });
      get().refreshLocal();
    } finally {
      set({ syncing: false });
    }
  },
  toggleLike: (id) => {
    if (isEntryReadOnly()) return;
    const likedIds = get().likedIds.includes(id) ? get().likedIds.filter((value) => value !== id) : [...get().likedIds, id];
    const persistLocally = !get().serverInitialized;
    set({ likedIds }); if (persistLocally) save(likedIds, get().cartIds);
  },
  addToCart: (id) => {
    if (isEntryReadOnly()) return;
    const cartIds = get().cartIds.includes(id) ? get().cartIds : [...get().cartIds, id];
    const persistLocally = !get().serverInitialized;
    set({ cartIds }); if (persistLocally) save(get().likedIds, cartIds);
  },
  removeFromCart: (id) => {
    if (isEntryReadOnly()) return;
    const cartIds = get().cartIds.filter((value) => value !== id);
    const persistLocally = !get().serverInitialized;
    set({ cartIds }); if (persistLocally) save(get().likedIds, cartIds);
  },
  clearCart: () => { if (isEntryReadOnly()) return; const persistLocally = !get().serverInitialized; set({ cartIds: [] }); if (persistLocally) save(get().likedIds, []); },
  replaceCart: (ids) => { const cartIds = [...new Set(ids)]; set({ cartIds, serverInitialized: true }); },
}));
