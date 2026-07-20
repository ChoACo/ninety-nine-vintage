"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { CatalogImage } from "@/components/ui/CatalogImage";

interface OrderItem {
  id: string;
  product_id: string;
  unit_price: number;
  payment_status: string;
  products?: {
    id: string;
    title: string;
    image_urls: string[];
    status: string;
  } | null;
}

interface Transfer {
  expected_amount: number;
  bank_name_snapshot: string;
  account_number_snapshot: string;
  status: string;
}

interface PortOnePayment {
  paymentStatus: string;
  portoneStatus: string | null;
  requestedMethod: string;
  paymentMethod: string | null;
  canResume: boolean;
  virtualAccount: {
    accountNumber: string;
    bank: string | null;
    dueAt: string | null;
  } | null;
}

interface Order {
  id: string;
  status: string;
  total: number;
  created_at: string;
  commerce_order_items?: OrderItem[];
  transfer?: Transfer | null;
  portonePayment?: PortOnePayment | null;
}

const statusLabels: Record<string, string> = {
  awaiting_payment: "입금 대기",
  paid: "결제 완료·보관 중",
  partially_paid: "부분 취소·환불 조정 중",
  shipped: "배송 완료",
  cancelled: "취소",
};

function statusLabel(order: Order): string {
  if (order.status === "awaiting_payment" && order.portonePayment) {
    return order.portonePayment.virtualAccount
      ? "가상계좌 입금 대기"
      : "결제 대기";
  }
  return statusLabels[order.status] ?? order.status;
}

function formatDueAt(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString("ko-KR")
    : null;
}

function OrderProductCard({ item }: { item: OrderItem }) {
  const product = item.products;
  const content = (
    <>
      {product?.image_urls?.[0] ? (
        <CatalogImage
          alt=""
          className="size-12 object-cover"
          loading="lazy"
          src={product.image_urls[0]}
        />
      ) : (
        <div className="size-12 bg-surface" />
      )}
      <span className="min-w-0">
        <span className="block truncate text-xs font-bold">
          {product?.title ?? "판매가 종료된 상품"}
        </span>
        {!product && (
          <span className="mt-1 block font-mono text-[9px] text-muted">
            상품 번호 {item.product_id.slice(0, 8)}
          </span>
        )}
      </span>
    </>
  );

  if (!product || product.status !== "active") {
    return (
      <div className="flex w-[220px] items-center gap-3 border border-line p-2">
        {content}
      </div>
    );
  }

  return (
    <Link
      className="flex w-[220px] items-center gap-3 border border-line p-2"
      href={`/auction/${product.id}`}
    >
      {content}
    </Link>
  );
}

export function OrderHistory() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    let requestGeneration = 0;
    let currentUserId: string | null = null;
    let currentAccessToken: string | null = null;
    let handledSession = false;

    const handleSession = (session: Session | null) => {
      if (!active) return;

      const nextUserId = session?.user.id ?? null;
      const nextAccessToken = session?.access_token ?? null;
      if (
        handledSession &&
        currentUserId === nextUserId &&
        currentAccessToken === nextAccessToken
      ) {
        return;
      }

      handledSession = true;
      const accountChanged = currentUserId !== nextUserId;
      currentUserId = nextUserId;
      currentAccessToken = nextAccessToken;
      const generation = ++requestGeneration;

      if (!nextUserId || !nextAccessToken) {
        setOrders([]);
        setLoaded(true);
        return;
      }

      if (accountChanged) {
        setOrders([]);
        setLoaded(false);
      }

      void (async () => {
        try {
          const response = await fetch("/api/orders", {
            headers: { Authorization: `Bearer ${nextAccessToken}` },
            cache: "no-store",
          });
          if (response.ok) {
            const payload = (await response.json()) as { orders?: Order[] };
            if (
              active &&
              generation === requestGeneration &&
              currentUserId === nextUserId
            ) {
              setOrders(payload.orders ?? []);
            }
          }
        } catch {
          // Guests and local builds without Supabase do not have order history.
        } finally {
          if (
            active &&
            generation === requestGeneration &&
            currentUserId === nextUserId
          ) {
            setLoaded(true);
          }
        }
      })();
    };

    try {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        handleSession(session);
      });

      const generationBeforeInitialSession = requestGeneration;
      void supabase.auth
        .getSession()
        .then(({ data }) => {
          if (
            active &&
            requestGeneration === generationBeforeInitialSession
          ) {
            handleSession(data.session);
          }
        })
        .catch(() => {
          if (
            active &&
            requestGeneration === generationBeforeInitialSession
          ) {
            handleSession(null);
          }
        });

      return () => {
        active = false;
        requestGeneration += 1;
        subscription.unsubscribe();
      };
    } catch {
      queueMicrotask(() => {
        if (!active) return;
        setOrders([]);
        setLoaded(true);
      });

      return () => {
        active = false;
        requestGeneration += 1;
      };
    }
  }, []);

  if (!loaded || orders.length === 0) return null;

  return (
    <section id="orders">
      <div className="mb-5 flex items-end justify-between border-b border-ink pb-4">
        <div>
          <p className="eyebrow text-muted">ORDERS / BUY NOW</p>
          <h2 className="mt-2 text-xl font-black tracking-[-0.05em]">
            즉시구매 주문
          </h2>
        </div>
        <Link className="text-xs font-bold underline" href="/shop">
          BUY NOW 계속 보기
        </Link>
      </div>
      <div className="divide-y divide-line border-y border-line">
        {orders.map((order) => {
          const virtualAccount = order.portonePayment?.virtualAccount ?? null;
          const dueAt = formatDueAt(virtualAccount?.dueAt ?? null);
          return (
            <article className="py-5" key={order.id}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-mono text-[10px] text-muted">
                    {new Date(order.created_at).toLocaleString("ko-KR")} ·{" "}
                    {order.id}
                  </p>
                  <p className="mt-2 text-sm font-bold">
                    {statusLabel(order)}
                  </p>
                </div>
                <strong className="font-mono text-sm">
                  {order.total.toLocaleString("ko-KR")}원
                </strong>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                {(order.commerce_order_items ?? []).map((item) => (
                  <OrderProductCard item={item} key={item.id} />
                ))}
              </div>
              {order.status === "awaiting_payment" && order.transfer && (
                <p className="mt-4 border border-amber-200 bg-amber-50 px-3 py-3 text-[11px] leading-5 text-amber-900">
                  {order.transfer.expected_amount.toLocaleString("ko-KR")}원 ·{" "}
                  {order.transfer.bank_name_snapshot}{" "}
                  {order.transfer.account_number_snapshot}로 입금해 주세요. 입금
                  확인 후 보관 기간이 시작됩니다.
                </p>
              )}
              {order.status === "awaiting_payment" && virtualAccount && (
                <p className="mt-4 border border-blue-200 bg-blue-50 px-3 py-3 text-[11px] leading-5 text-blue-900">
                  가상계좌 · {virtualAccount.bank ? `${virtualAccount.bank} ` : ""}
                  {virtualAccount.accountNumber}로 입금해 주세요.
                  {dueAt ? ` 입금 기한은 ${dueAt}입니다.` : ""} 입금 확인 후
                  보관 기간이 시작됩니다.
                </p>
              )}
              {order.portonePayment?.canResume && (
                <Link
                  className="mt-4 inline-flex border border-ink px-4 py-2 text-[11px] font-bold"
                  href={`/cart?resumeOrder=${encodeURIComponent(order.id)}`}
                >
                  동일 결제 번호로 결제 재개
                </Link>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
