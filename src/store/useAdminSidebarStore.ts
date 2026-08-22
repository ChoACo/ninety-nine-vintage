import { create } from "zustand";

type WorkspaceMode = "operator" | "owner";

interface AdminSidebarState {
  collapsed: Record<WorkspaceMode, boolean>;
  hydrate: (mode: WorkspaceMode, value: boolean) => void;
  toggle: (mode: WorkspaceMode) => void;
}

export const useAdminSidebarStore = create<AdminSidebarState>((set) => ({
  collapsed: { operator: false, owner: false },
  hydrate: (mode, value) => set((state) => ({ collapsed: { ...state.collapsed, [mode]: value } })),
  toggle: (mode) => set((state) => ({ collapsed: { ...state.collapsed, [mode]: !state.collapsed[mode] } })),
}));
