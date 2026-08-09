"use client";

import { create } from "zustand";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface OperatorStoreScope {
  active: boolean;
  accessMode: "assigned" | "owner_support";
  storeId: string | null;
  expiresAt: string | null;
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
  error: string | null;
  load: () => Promise<void>;
  select: (next: OperatorStoreScope) => Promise<boolean>;
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
    scope: { active: false, accessMode: "assigned", storeId: null, expiresAt: null },
    stores: [],
    loaded: false,
    busy: false,
    error: null,
    load: async () => {
      if (get().busy) return;
      set({ busy: true, error: null });
      try {
        const { ok, payload } = await fetchWithToken();
        if (ok) {
          set({
            scope: payload.scope ?? { active: false, accessMode: "assigned", storeId: null, expiresAt: null },
            stores: payload.stores ?? [],
            loaded: true,
            busy: false,
          });
        } else {
          set({ loaded: true, busy: false, error: payload.error ?? "센터 범위를 불러오지 못했습니다." });
        }
      } catch (error) {
        set({
          loaded: true,
          busy: false,
          error: error instanceof Error ? error.message : "센터 범위를 불러오지 못했습니다.",
        });
      }
    },
    select: async (next) => {
      if (get().busy) return false;
      set({ busy: true, error: null });
      try {
        const { ok, payload } = await fetchWithToken({
          method: "POST",
          body: JSON.stringify({ storeId: next.storeId, accessMode: next.accessMode }),
        });
        if (!ok) {
          throw new Error(payload.error ?? "센터 범위를 저장하지 못했습니다.");
        }
        if (!payload.scope) throw new Error("센터 범위 응답을 확인하지 못했습니다.");
        set({ scope: payload.scope, error: null });
        return true;
      } catch (error) {
        set({ error: error instanceof Error ? error.message : "센터 범위를 저장하지 못했습니다." });
        return false;
      } finally {
        set({ busy: false });
      }
    },
  }),
);
