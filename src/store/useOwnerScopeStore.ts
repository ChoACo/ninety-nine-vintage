"use client";

import { create } from "zustand";

export interface OwnerScopeStoreOption { id: string; name: string; slug: string }

interface OwnerScopeState {
  selectedStoreId: string | null;
  stores: OwnerScopeStoreOption[];
  setSelectedStoreId: (storeId: string | null) => void;
  setStores: (stores: OwnerScopeStoreOption[]) => void;
}

export const useOwnerScopeStore = create<OwnerScopeState>((set) => ({
  selectedStoreId: null,
  stores: [],
  setSelectedStoreId: (selectedStoreId) => {
    set({ selectedStoreId });
    if (typeof window !== "undefined") window.localStorage.setItem("ninety-nine:owner-scope", selectedStoreId ?? "all");
  },
  setStores: (stores) => set((state) => {
    const saved = typeof window === "undefined" ? null : window.localStorage.getItem("ninety-nine:owner-scope");
    const selectedStoreId = state.selectedStoreId ?? (saved && saved !== "all" && stores.some((store) => store.id === saved) ? saved : null);
    return { stores, selectedStoreId };
  }),
}));
