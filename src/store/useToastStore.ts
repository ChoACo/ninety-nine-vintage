"use client";

import { create } from "zustand";

export interface AppToastAction {
  label: string;
  href: string;
}

export interface AppToast {
  id: number;
  kind: "error" | "success";
  text: string;
  durationMs?: number;
  action?: AppToastAction;
}

export interface ToastOptions {
  action?: AppToastAction;
  durationMs?: number;
}

interface ToastState {
  toasts: AppToast[];
  pushToast: (kind: AppToast["kind"], text: string, options?: ToastOptions) => void;
  dismissToast: (id: number) => void;
}

let nextToastId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  pushToast: (kind, text, options = {}) => {
    const id = nextToastId++;
    set((state) => ({
      toasts: [
        ...state.toasts.slice(-2),
        { id, kind, text, durationMs: options.durationMs, action: options.action },
      ],
    }));
  },
  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));
