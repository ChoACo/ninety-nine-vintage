"use client";

import { create } from "zustand";

interface CommerceState {
  hydrated: boolean;
  likedIds: string[];
  cartIds: string[];
  hydrate: () => void;
  toggleLike: (id: string) => void;
  addToCart: (id: string) => void;
  removeFromCart: (id: string) => void;
  clearCart: () => void;
}

const KEY = "ninetynine-commerce-demo";
const save = (likedIds: string[], cartIds: string[]) => {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify({ likedIds, cartIds }));
};

export const useCommerceStore = create<CommerceState>((set, get) => ({
  hydrated: false, likedIds: [], cartIds: [],
  hydrate: () => {
    if (get().hydrated || typeof window === "undefined") return;
    try {
      const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as { likedIds?: string[]; cartIds?: string[] };
      set({ hydrated: true, likedIds: raw.likedIds ?? [], cartIds: raw.cartIds ?? [] });
    } catch { set({ hydrated: true }); }
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
}));

