"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isEntryReadOnly } from "@/lib/entryMode";

export async function persistWishlist(
  productId: string,
  liked: boolean,
  expectedUserId?: string,
): Promise<boolean> {
  if (isEntryReadOnly()) return false;
  try {
    const client = getSupabaseBrowserClient();
    const { data } = await client.auth.getSession();
    const session = data.session;
    const token = session?.access_token;
    if (expectedUserId && session?.user.id !== expectedUserId) return false;
    if (!token) return expectedUserId === undefined;
    const response = await fetch("/api/wishlist", {
      method: liked ? "POST" : "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ productId }),
    });
    if (!response.ok) return false;
    if (expectedUserId) {
      const latest = (await client.auth.getSession()).data.session;
      return (
        latest?.user.id === expectedUserId && latest.access_token === token
      );
    }
    return true;
  } catch {
    return false;
  }
}

export async function persistCart(
  productId: string,
  inCart: boolean,
  expectedUserId?: string,
): Promise<boolean> {
  if (isEntryReadOnly()) return false;
  try {
    const client = getSupabaseBrowserClient();
    const { data } = await client.auth.getSession();
    const session = data.session;
    const token = session?.access_token;
    if (!token || (expectedUserId && session.user.id !== expectedUserId)) {
      return false;
    }
    const response = await fetch("/api/cart", {
      method: inCart ? "POST" : "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ productId }),
    });
    if (!response.ok) return false;
    if (expectedUserId) {
      const latest = (await client.auth.getSession()).data.session;
      return (
        latest?.user.id === expectedUserId && latest.access_token === token
      );
    }
    return true;
  } catch {
    // The local store remains a temporary presentation cache until login.
    return false;
  }
}
