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
    sale_type: "fixed" | "auction";
  } | null;
}

interface Transfer {
  expected_amount: number;
  bank_name_snapshot: string;
  account_number_snapshot: string;
  status: string;
  payment_due_at?: string | null;
}

interface LegacyPaymentHistory {
  paymentId: string;
  paymentStatus: string;
  providerStatus: string | null;
  paidAt: string | null;
}

interface Order {
  id: string;
  status: string;
  total: number;
  created_at: string;
  commerce_order_items?: OrderItem[];
  transfer?: Transfer | null;
  direct_ship?: boolean;
  shipping_address_snapshot?: { address?: string; label?: string; recipientName?: string } | null;
  payment_due_at?: string | null;
  legacyPaymentHistory?: LegacyPaymentHistory | null;
  paymentConfirmation?: {
    eligibleAt: string | null;
    canRequest: boolean;
    request: {
      id: string;
      status: "open" | "resolved";
      first_requested_at: string;
      last_requested_at: string;
      reminder_count: number;
    } | null;
  };
}

const statusLabels: Record<string, string> = {
  awaiting_payment: "입금 대기 중",
  paid: "결제 완료·보관 중",
  partially_paid: "부분 취소·환불 조정 중",
  shipped: "배송 완료",
  cancelled: "취소",
};

function statusLabel(order: Order): string {
  if (order.direct_ship && order.status === "paid") return "결제 완료·배송 접수 중";
  return statusLabels[order.status] ?? "상태 확인 중";
}

function OrderProductCard({ basePath, item, surface }: { basePath: "" | "/m"; item: OrderItem; surface: "desktop" | "mobile" }) {
  const product = item.products;
  const content = (
    <>
      {product?.image_urls?.[0] ? (
        <CatalogImage
          alt=""
          className="size-12 object-cover"
          loading="lazy"
          sizes="48px"
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
      <div className={`flex items-center gap-3 border border-line p-2 ${surface === "desktop" ? "w-[220px]" : "w-full"}`}>
        {content}
      </div>
    );
  }

  return (
    <Link
      className={`flex items-center gap-3 border border-line p-2 ${surface === "desktop" ? "w-[220px]" : "w-full"}`}
      href={`${basePath}/auction/${product.id}`}
    >
      {content}
    </Link>
  );
}

export function OrderHistory({ basePath = "", surface = "mobile" }: { basePath?: "" | "/m"; surface?: "desktop" | "mobile" }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [confirmationBusyOrderId, setConfirmationBusyOrderId] = useState<string | null>(null);
  const [confirmationNotice, setConfirmationNotice] = useState("");
  const [cancellationByProduct, setCancellationByProduct] = useState<Record<string, string>>({});
  const [cancellationBusyProductId, setCancellationBusyProductId] = useState<string | null>(null);

  const requestCancellation = async (productId: string) => {
    if (cancellationBusyProductId) return;
    setCancellationBusyProductId(productId);
    setConfirmationNotice("");
    try {
      const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
      if (!session) throw new Error("로그인 상태를 확인해 주세요.");
      const response = await fetch("/api/account/cancellations", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ productId, reasonCode: "buyer_changed_mind", reasonDetail: "구매자가 주문 내역에서 취소를 요청했습니다.", idempotencyKey: crypto.randomUUID() }),
      });
      const payload = await response.json() as { error?: string; cancellation?: { status?: string } };
      if (!response.ok) throw new Error(payload.error ?? "취소 요청을 보내지 못했습니다.");
      setCancellationByProduct((current) => ({ ...current, [productId]: payload.cancellation?.status ?? "requested_by_buyer" }));
      setConfirmationNotice("판매 매장에 취소 요청을 보냈습니다. 수락 전까지 배송 처리가 중지됩니다.");
    } catch (error) {
      setConfirmationNotice(error instanceof Error ? error.message : "취소 요청을 보내지 못했습니다.");
    } finally {
      setCancellationBusyProductId(null);
    }
  };

  const requestPaymentConfirmation = async (orderId: string) => {
    if (confirmationBusyOrderId) return;
    setConfirmationBusyOrderId(orderId);
    setConfirmationNotice("");
    try {
      const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
      if (!session) throw new Error("로그인 상태를 확인해 주세요.");
      const response = await fetch(`/api/orders/${orderId}/payment-confirmation-request`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
      });
      const payload = (await response.json()) as {
        error?: string;
        request?: {
          id: string;
          status: "open" | "resolved";
          firstRequestedAt: string;
          lastRequestedAt: string;
          reminderCount: number;
        };
      };
      if (!response.ok) throw new Error(payload.error ?? "입금 확인 요청을 보내지 못했습니다.");
      if (!payload.request) throw new Error("입금 확인 요청 결과를 확인하지 못했습니다.");
      setOrders((current) => current.map((order) => order.id === orderId ? {
        ...order,
        paymentConfirmation: {
          eligibleAt: order.paymentConfirmation?.eligibleAt ?? null,
          canRequest: true,
          request: {
            id: payload.request!.id,
            status: payload.request!.status,
            first_requested_at: payload.request!.firstRequestedAt,
            last_requested_at: payload.request!.lastRequestedAt,
            reminder_count: payload.request!.reminderCount,
          },
        },
      } : order));
      setConfirmationNotice("소유자에게 입금 확인을 요청했습니다.");
    } catch (error) {
      setConfirmationNotice(error instanceof Error ? error.message : "입금 확인 요청을 보내지 못했습니다.");
    } finally {
      setConfirmationBusyOrderId(null);
    }
  };

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
          const [response, cancellationResponse] = await Promise.all([
            fetch("/api/orders", { headers: { Authorization: `Bearer ${nextAccessToken}` }, cache: "no-store" }),
            fetch("/api/account/cancellations", { headers: { Authorization: `Bearer ${nextAccessToken}` }, cache: "no-store" }),
          ]);
          if (response.ok) {
            const payload = (await response.json()) as { orders?: Order[] };
            if (
              active &&
              generation === requestGeneration &&
              currentUserId === nextUserId
            ) {
              setOrders(payload.orders ?? []);
              if (cancellationResponse.ok) {
                const cancellationPayload = await cancellationResponse.json() as { cancellations?: Array<{ product_id: string; status: string }> };
                setCancellationByProduct(Object.fromEntries((cancellationPayload.cancellations ?? []).map((item) => [item.product_id, item.status])));
              }
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
      <div className={`mb-5 flex items-start gap-3 border-b border-ink pb-4 ${surface === "desktop" ? "flex-row items-end justify-between" : "flex-col"}`}>
        <div>
          <p className="eyebrow text-muted">주문 내역 / 즉시구매</p>
          <h2 className="mt-2 text-xl font-black tracking-[-0.05em]">
            즉시구매 주문
          </h2>
        </div>
        <Link className="text-xs font-bold underline" href={`${basePath}/shop`}>
          즉시구매 상품 더 보기
        </Link>
      </div>
      <div className="divide-y divide-line border-y border-line">
        {confirmationNotice && <p className="py-3 text-xs font-bold" role="status">{confirmationNotice}</p>}
        {orders.map((order) => (
            <article className="py-5" key={order.id}>
              <div className={`flex gap-3 ${surface === "desktop" ? "flex-row items-center justify-between gap-4" : "flex-col"}`}>
                <div className="min-w-0">
                  <p className="break-all font-mono text-[10px] text-muted">
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
                  <div key={item.id}>
                    <OrderProductCard basePath={basePath} item={item} surface={surface} />
                    {item.products?.sale_type === "fixed" && item.payment_status === "paid" && (
                      <button className="mt-2 w-full border border-line px-3 py-2 text-[11px] font-bold disabled:opacity-50"
                        disabled={Boolean(cancellationByProduct[item.product_id]) || cancellationBusyProductId === item.product_id}
                        onClick={() => void requestCancellation(item.product_id)} type="button">
                        {cancellationByProduct[item.product_id] ? "취소 요청 처리 중" : cancellationBusyProductId === item.product_id ? "요청 중" : "취소 요청"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {order.status === "awaiting_payment" && order.transfer && (
                <p className="mt-4 border border-amber-200 bg-amber-500/10 px-3 py-3 text-[11px] leading-5 text-amber-900">
                  {order.transfer.expected_amount.toLocaleString("ko-KR")}원 ·{" "}
                  {order.transfer.bank_name_snapshot}{" "}
                  {order.transfer.account_number_snapshot}로 입금해 주세요. 입금
                  확인 후 상품이 보관함으로 이동하며, 보관 기간은 매장 보관 시작일부터 계산됩니다.
                </p>
              )}
              {order.legacyPaymentHistory && (
                <p className="mt-4 border border-line bg-surface px-3 py-3 text-[11px] leading-5 text-muted">
                  과거 외부 결제 기록 · {order.legacyPaymentHistory.paymentId} · {order.legacyPaymentHistory.providerStatus ?? order.legacyPaymentHistory.paymentStatus}
                </p>
              )}
              {order.status === "awaiting_payment" &&
                order.paymentConfirmation?.canRequest && (
                  <div className="mt-3 flex items-center justify-between gap-3 border border-line px-3 py-3 text-[11px]">
                    <span>
                      {order.paymentConfirmation.request?.status === "open"
                        ? `입금 확인 요청됨 · 재알림 ${order.paymentConfirmation.request.reminder_count}회`
                        : `${order.direct_ship ? "6시간" : "12시간"} 이내 입금해야 하며, 반복 미입금 시 구매·입찰 이용이 제한될 수 있습니다.`}
                    </span>
                    <button
                      className="shrink-0 bg-ink px-3 py-2 font-bold text-paper disabled:opacity-50"
                      disabled={confirmationBusyOrderId === order.id}
                      onClick={() => void requestPaymentConfirmation(order.id)}
                      type="button"
                    >
                      {order.paymentConfirmation.request?.status === "open" ? "다시 알림" : "결제 확인 요청하기"}
                    </button>
                  </div>
                )}
            </article>
        ))}
      </div>
    </section>
  );
}
