"use client";

import { create } from "zustand";

export type SalesRangePreset = "today" | "7d" | "30d" | "month" | "custom";

interface SalesDateRangeState {
  preset: SalesRangePreset;
  from: string;
  to: string;
  setRange: (preset: SalesRangePreset, from: string, to: string) => void;
}

export const useSalesDateRangeStore = create<SalesDateRangeState>((set) => ({
  preset: "30d",
  from: "",
  to: "",
  setRange: (preset, from, to) => set({ preset, from, to }),
}));
