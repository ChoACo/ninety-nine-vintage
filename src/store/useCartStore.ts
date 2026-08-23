"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CartShippingMode = "vault" | "ship";

interface CartUiState {
  selectedIds: string[];
  shippingModes: Record<string, CartShippingMode>;
  toggleSelected: (id: string) => void;
  setShippingMode: (storeId: string, mode: CartShippingMode) => void;
  clearSelection: () => void;
  reconcileCartIds: (ids: readonly string[]) => void;
}

export const useCartStore = create<CartUiState>()(
  persist(
    (set) => ({
      selectedIds: [],
      shippingModes: {},
      toggleSelected: (id) =>
        set((state) => ({
          selectedIds: state.selectedIds.includes(id)
            ? state.selectedIds.filter((value) => value !== id)
            : [...state.selectedIds, id],
        })),
      setShippingMode: (storeId, mode) =>
        set((state) => ({
          shippingModes: { ...state.shippingModes, [storeId]: mode },
        })),
      clearSelection: () => set({ selectedIds: [] }),
      reconcileCartIds: (ids) =>
        set((state) => {
          const validIds = new Set(ids);
          return {
            selectedIds: state.selectedIds.filter((id) => validIds.has(id)),
            shippingModes:
              validIds.size === 0 ? {} : state.shippingModes,
          };
        }),
    }),
    {
      name: "ninetynine-cart-ui-v1",
      partialize: (state) => ({
        selectedIds: state.selectedIds,
        shippingModes: state.shippingModes,
      }),
    },
  ),
);
