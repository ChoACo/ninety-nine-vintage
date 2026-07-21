"use client";

import { create } from "zustand";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  canCommitCommerceSnapshot,
  shouldPersistCommerceLocally,
  type CommerceOwnerMode,
} from "@/lib/commerce/cacheOwnership";

interface CommerceState {
  hydrated: boolean;
  syncing: boolean;
  serverInitialized: boolean;
  ownerMode: CommerceOwnerMode;
  ownerUserId: string | null;
  likedIds: string[];
  cartIds: string[];
  hydrate: () => void;
  refreshLocal: () => void;
  resetForSession: (userId: string | null) => void;
  syncWithServer: () => Promise<void>;
  toggleLike: (id: string) => void;
  addToCart: (id: string) => void;
  removeFromCart: (id: string) => void;
  removePurchasedFromCart: (ids: readonly string[]) => void;
  clearCart: () => void;
  replaceCart: (ids: string[]) => void;
}

const KEY = "ninetynine-commerce-cache";
let syncGeneration = 0;
let syncQueued = false;
let serverUserId: string | null | undefined;
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
  hydrated: false, syncing: false, serverInitialized: false, ownerMode: "unknown", ownerUserId: null, likedIds: [], cartIds: [],
  hydrate: () => {
    if (get().hydrated || typeof window === "undefined") return;
    // Shared browser storage belongs only to a confirmed guest. Reading it
    // while auth ownership is still unknown can briefly expose a previous
    // guest/account's cart and wishlist before the member snapshot arrives.
    if (get().ownerMode === "guest") {
      const local = readLocal();
      set({ hydrated: true, likedIds: local.likedIds, cartIds: local.cartIds });
      return;
    }
    set({ hydrated: true, likedIds: [], cartIds: [] });
  },
  refreshLocal: () => {
    if (typeof window === "undefined" || get().ownerMode !== "guest") return;
    const local = readLocal();
    set({ hydrated: true, likedIds: local.likedIds, cartIds: local.cartIds });
  },
  resetForSession: (userId) => {
    // Invalidate every response that was started under an older auth event.
    syncGeneration += 1;
    if (
      serverUserId === userId &&
      get().ownerUserId === userId &&
      get().ownerMode !== "unknown"
    ) return;
    serverUserId = userId;
    if (userId) {
      set({
        hydrated: true,
        serverInitialized: false,
        ownerMode: "member-loading",
        ownerUserId: userId,
        likedIds: [],
        cartIds: [],
      });
      return;
    }
    const local = readLocal();
    set({
      hydrated: true,
      serverInitialized: false,
      ownerMode: "guest",
      ownerUserId: null,
      likedIds: local.likedIds,
      cartIds: local.cartIds,
    });
  },
  syncWithServer: async () => {
    const generation = ++syncGeneration;
    if (get().syncing) {
      syncQueued = true;
      return;
    }
    set({ syncing: true });
    let authenticatedUserId: string | null = null;
    try {
      const client = getSupabaseBrowserClient();
      const { data } = await client.auth.getSession();
      const session = data.session;
      if (generation !== syncGeneration) return;
      if (!session?.access_token) {
        serverUserId = null;
        const local = readLocal();
        set({
          hydrated: true,
          serverInitialized: false,
          ownerMode: "guest",
          ownerUserId: null,
          likedIds: local.likedIds,
          cartIds: local.cartIds,
        });
        return;
      }
      authenticatedUserId = session.user.id;
      if (
        serverUserId !== authenticatedUserId ||
        get().ownerMode === "unknown" ||
        get().ownerMode === "guest"
      ) {
        serverUserId = authenticatedUserId;
        set({
          hydrated: true,
          serverInitialized: false,
          ownerMode: "member-loading",
          ownerUserId: authenticatedUserId,
          likedIds: [],
          cartIds: [],
        });
      }
      const token = session.access_token;
      const headers = { Authorization: `Bearer ${token}` };
      const [cartResponse, wishlistResponse] = await Promise.all([
        fetch("/api/cart", { headers, cache: "no-store" }),
        fetch("/api/wishlist", { headers, cache: "no-store" }),
      ]);
      if (generation !== syncGeneration) return;
      const latestSession = (await client.auth.getSession()).data.session;
      if (!canCommitCommerceSnapshot({
        generation,
        currentGeneration: syncGeneration,
        expectedUserId: authenticatedUserId,
        expectedAccessToken: token,
        currentSession: latestSession,
      })) return;
      // An authenticated 5xx must not replace this member's last server
      // snapshot with the anonymous local cache. A queued retry will refresh it.
      if (!cartResponse.ok || !wishlistResponse.ok) return;
      const [cartPayload, wishlistPayload] = await Promise.all([
        cartResponse.json() as Promise<{ productIds?: string[] }>,
        wishlistResponse.json() as Promise<{ productIds?: string[] }>,
      ]);
      const commitSession = (await client.auth.getSession()).data.session;
      if (!canCommitCommerceSnapshot({
        generation,
        currentGeneration: syncGeneration,
        expectedUserId: authenticatedUserId,
        expectedAccessToken: token,
        currentSession: commitSession,
      })) return;
      const serverCartIds = cartPayload.productIds ?? [];
      const serverLikedIds = wishlistPayload.productIds ?? [];
      set({ cartIds: serverCartIds, likedIds: serverLikedIds, hydrated: true, serverInitialized: true, ownerMode: "member-ready", ownerUserId: authenticatedUserId });
    } catch {
      // A session read or member API failure is not proof of logout. Preserve
      // the current ownership mode and snapshot until an auth event confirms it.
    } finally {
      set({ syncing: false });
      if (syncQueued) {
        syncQueued = false;
        queueMicrotask(() => void get().syncWithServer());
      }
    }
  },
  toggleLike: (id) => {
    const likedIds = get().likedIds.includes(id) ? get().likedIds.filter((value) => value !== id) : [...get().likedIds, id];
    const persistLocally = shouldPersistCommerceLocally(get().ownerMode);
    set({ likedIds }); if (persistLocally) save(likedIds, get().cartIds);
  },
  addToCart: (id) => {
    const cartIds = get().cartIds.includes(id) ? get().cartIds : [...get().cartIds, id];
    const persistLocally = shouldPersistCommerceLocally(get().ownerMode);
    set({ cartIds }); if (persistLocally) save(get().likedIds, cartIds);
  },
  removeFromCart: (id) => {
    const cartIds = get().cartIds.filter((value) => value !== id);
    const persistLocally = shouldPersistCommerceLocally(get().ownerMode);
    set({ cartIds }); if (persistLocally) save(get().likedIds, cartIds);
  },
  removePurchasedFromCart: (ids) => {
    const purchasedIds = new Set(ids.filter(Boolean));
    if (purchasedIds.size === 0) return;
    if (shouldPersistCommerceLocally(get().ownerMode)) {
      const local = readLocal();
      const likedIds = get().hydrated ? get().likedIds : local.likedIds;
      const cartIds = (get().hydrated ? get().cartIds : local.cartIds).filter(
        (id) => !purchasedIds.has(id),
      );
      set({ cartIds, likedIds, hydrated: true });
      save(likedIds, cartIds);
      return;
    }
    set({
      cartIds: get().cartIds.filter((id) => !purchasedIds.has(id)),
      hydrated: true,
    });
  },
  clearCart: () => { const persistLocally = shouldPersistCommerceLocally(get().ownerMode); set({ cartIds: [] }); if (persistLocally) save(get().likedIds, []); },
  replaceCart: (ids) => { const cartIds = [...new Set(ids)]; set({ cartIds, serverInitialized: true, ownerMode: get().ownerMode === "guest" ? "guest" : "member-ready" }); },
}));
