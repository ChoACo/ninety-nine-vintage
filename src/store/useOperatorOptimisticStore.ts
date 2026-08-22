"use client";

import { create } from "zustand";

interface OperatorOptimisticState {
  productStatus: Record<string, string>;
  shipmentStatus: Record<string, string>;
  setProductStatus: (id: string, status: string | null) => void;
  setShipmentStatus: (id: string, status: string | null) => void;
}

export const useOperatorOptimisticStore = create<OperatorOptimisticState>((set) => ({
  productStatus: {},
  shipmentStatus: {},
  setProductStatus: (id, status) => set((state) => {
    const next = { ...state.productStatus };
    if (status === null) delete next[id]; else next[id] = status;
    return { productStatus: next };
  }),
  setShipmentStatus: (id, status) => set((state) => {
    const next = { ...state.shipmentStatus };
    if (status === null) delete next[id]; else next[id] = status;
    return { shipmentStatus: next };
  }),
}));
