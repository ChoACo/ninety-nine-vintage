"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export async function persistWishlist(
  productId: string,
  liked: boolean,
  expectedUserId?: string,
): Promise<boolean> {
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

export interface CartReservation {
  productId: string;
  reservedUntil: string;
  serverTime: string;
}

export async function reserveCartProduct(
  productId: string,
  expectedUserId?: string,
): Promise<CartReservation> {
  const client = getSupabaseBrowserClient();
  const session = (await client.auth.getSession()).data.session;
  if (!session?.access_token || (expectedUserId && session.user.id !== expectedUserId)) {
    throw new Error("카카오 회원 로그인 후 장바구니를 이용해 주세요.");
  }
  const token = session.access_token;
  const response = await fetch("/api/cart", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ productId }),
  });
  const payload = await response.json().catch(() => null) as Partial<CartReservation> & { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || "상품 재고를 점유하지 못했습니다.");
  if (payload?.productId !== productId || typeof payload.reservedUntil !== "string" || typeof payload.serverTime !== "string") {
    throw new Error("재고 점유 시간을 확인하지 못했습니다.");
  }
  const latest = (await client.auth.getSession()).data.session;
  if (latest?.user.id !== session.user.id || latest.access_token !== token) {
    throw new Error("로그인 계정이 변경되었습니다. 다시 시도해 주세요.");
  }
  return {
    productId,
    reservedUntil: payload.reservedUntil,
    serverTime: payload.serverTime,
  };
}

export async function persistCart(
  productId: string,
  inCart: boolean,
  expectedUserId?: string,
): Promise<boolean> {
  try {
    const client = getSupabaseBrowserClient();
    const { data } = await client.auth.getSession();
    const session = data.session;
    const token = session?.access_token;
    if (!token || (expectedUserId && session.user.id !== expectedUserId)) {
      return false;
    }
    if (inCart) {
      await reserveCartProduct(productId, session.user.id);
      return true;
    }
    const response = await fetch("/api/cart", {
      method: "DELETE",
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
