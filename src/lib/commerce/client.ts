"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isEntryReadOnly } from "@/lib/entryMode";

export async function persistWishlist(productId: string, liked: boolean) {
  if (isEntryReadOnly()) return;
  try {
    const { data } = await getSupabaseBrowserClient().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch("/api/wishlist", {
      method: liked ? "POST" : "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ productId }),
    });
  } catch {
    // Local storage remains available as an offline guest presentation cache.
  }
}

export async function persistCart(productId: string, inCart: boolean): Promise<boolean> {
  if (isEntryReadOnly()) return false;
  try {
    const { data } = await getSupabaseBrowserClient().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return false;
    const response = await fetch("/api/cart", {
      method: inCart ? "POST" : "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ productId }),
    });
    return response.ok;
  } catch {
    // The local store remains a temporary presentation cache until login.
    return false;
  }
}
