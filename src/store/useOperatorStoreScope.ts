"use client";

import { create } from "zustand";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface OperatorStoreScope {
  scope: "all" | "store";
  storeId: string | null;
}

export interface ScopeStore {
  id: string;
  name: string;
  slug: string;
}

interface OperatorStoreScopeState {
  scope: OperatorStoreScope;
  stores: ScopeStore[];
  loaded: boolean;
  busy: boolean;
  load: () => Promise<void>;
  select: (next: OperatorStoreScope) => Promise<void>;
}

async function fetchWithToken(
  init: RequestInit = {},
): Promise<{
  ok: boolean;
  payload: { scope?: OperatorStoreScope; stores?: ScopeStore[]; error?: string };
}> {
  const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
  const accessToken = session?.access_token;
  if (!accessToken) {
    throw new Error("로그인 세션을 확인해 주세요.");
  }
  const response = await fetch("/api/admin/operator/store-scope", {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...init.headers,
    },
  });
  const payload = (await response.json().catch(() => null)) as {
    scope?: OperatorStoreScope;
    stores?: ScopeStore[];
    error?: string;
  } | null;
  return { ok: response.ok, payload: payload ?? {} };
}

export const useOperatorStoreScope = create<OperatorStoreScopeState>(
  (set, get) => ({
    scope: { scope: "all", storeId: null },
    stores: [],
    loaded: false,
    busy: false,
    load: async () => {
      if (get().loaded) return;
      try {
        const { ok, payload } = await fetchWithToken();
        if (ok) {
          set({
            scope: payload.scope ?? { scope: "all", storeId: null },
            stores: payload.stores ?? [],
            loaded: true,
          });
        }
      } catch {
        set({ loaded: true });
      }
    },
    select: async (next) => {
      if (get().busy) return;
      set({ busy: true });
      try {
        const { ok, payload } = await fetchWithToken({
          method: "POST",
          body: JSON.stringify(next),
        });
        if (!ok) {
          throw new Error(payload.error ?? "센터 범위를 저장하지 못했습니다.");
        }
        set({ scope: next });
      } finally {
        set({ busy: false });
      }
    },
  }),
);
