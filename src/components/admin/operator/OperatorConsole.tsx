"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  Banknote,
  Clock3,
  Package,
  Truck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { OperatorSecondChanceButton } from "@/components/admin/operator/OperatorSecondChanceButton";
import { LocalTestMemberSwitcher } from "@/components/admin/LocalTestMemberSwitcher";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface Product {
  current_price: number;
  id: string;
  image_urls: string[];
  pending_lock_kind?: "buy_now_payment" | "auction_payment" | null;
  pending_lock_until?: string | null;
  sale_type: string;
  status: string;
  title: string;
}

interface ProductResponse {
  permissions?: { canMutate?: boolean };
  products?: Product[];
}

function productStatusLabel(status: string) {
  if (status === "pending") return "등록 대기";
  if (status === "active") return "공개 중";
  if (status === "closed") return "마감";
  if (status === "sold") return "판매 완료";
  return status;
}
function productStatusText(product: Product) {
  if (product.status === "closed" && product.pending_lock_kind === "buy_now_payment") {
    return "결제 진행 중";
  }
  if (product.status === "closed" && product.pending_lock_kind === "auction_payment") {
    return "낙찰 대기";
  }
  return productStatusLabel(product.status);
}

export function OperatorConsole({
  enableLocalTestMembers = false,
}: Readonly<{ enableLocalTestMembers?: boolean }>) {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState(0);
  const [shipping, setShipping] = useState(0);
  const [netRevenue, setNetRevenue] = useState(0);
  const [canMutate, setCanMutate] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const session = (
          await getSupabaseBrowserClient().auth.getSession()
        ).data.session;
        if (!session) return;
        const headers = { Authorization: `Bearer ${session.access_token}` };
        const today = new Date().toLocaleDateString("en-CA", {
          timeZone: "Asia/Seoul",
        });
        const monthStart = `${today.slice(0, 7)}-01`;
        const [
          productResponse,
          orderResponse,
          shippingResponse,
          revenueResponse,
        ] = await Promise.all([
          fetch("/api/admin/operator/products", { headers, cache: "no-store" }),
          fetch("/api/admin/operator/orders?summary=1", {
            headers,
            cache: "no-store",
          }),
          fetch("/api/admin/operator/shipping", { headers, cache: "no-store" }),
          fetch(
            `/api/admin/operator/revenue?from=${monthStart}&to=${today}`,
            {
            headers,
            cache: "no-store",
            },
          ),
        ]);
        const productData = await productResponse.json() as ProductResponse;
        const orderData = await orderResponse.json() as {
          error?: string;
          activeCount?: number;
        };
        const shippingData = await shippingResponse.json() as {
          requests?: unknown[];
          totalCount?: number;
        };
        const revenueData = await revenueResponse.json() as {
          stores?: { netSales?: number }[];
        };
        if (!productResponse.ok) {
          throw new Error("운영자 권한을 확인할 수 없습니다.");
        }
        if (!orderResponse.ok) {
          throw new Error(
            orderData.error ?? "공용 입금 큐를 불러오지 못했습니다.",
          );
        }
        setProducts(productData.products ?? []);
        setCanMutate(productData.permissions?.canMutate === true);
        setOrders(orderData.activeCount ?? 0);
        setShipping(shippingData.totalCount ?? shippingData.requests?.length ?? 0);
        setNetRevenue(
          revenueResponse.ok
            ? (revenueData.stores ?? []).reduce(
                (sum, store) => sum + (store.netSales ?? 0),
                0,
              )
            : 0,
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "운영자 데이터를 불러오지 못했습니다.",
        );
      }
    })();
  }, []);

  const stats = [
    [
      "공개 상품",
      products.filter((product) => product.status === "active").length,
      Package,
    ],
    ["공용 입금 확인 대기", orders, Clock3],
    ["배송 요청", shipping, Truck],
    ["이번 달 순매출", `${netRevenue.toLocaleString("ko-KR")}원`, Banknote],
  ] as const;
  const activeProducts = products.filter(
    (product) => product.status === "active"
      || (product.status === "closed" && Boolean(product.pending_lock_kind)),
  );

  return (
    <div className="space-y-10">
      <div className="flex flex-col items-stretch justify-between gap-5 border-b border-ink pb-7 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow text-muted">운영자 센터 / 통합 현황</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-0.06em] sm:text-4xl sm:tracking-[-0.08em]">
            메인
          </h1>
          <p className="mt-3 text-sm text-muted">
            소속 매장의 진행 상품, 입금 확인, 출고와 택배 업무를 확인합니다.
          </p>
        </div>
      </div>

      {notice && (
        <div
          className="border border-line bg-surface px-4 py-3 text-xs text-ink"
          role="status"
        >
          {notice}
        </div>
      )}
      {enableLocalTestMembers && <LocalTestMemberSwitcher />}

      <section className="border border-ink bg-ink p-6 text-paper">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="eyebrow text-paper/60">판매센터 / 지금 할 일</p>
            <h2 className="mt-2 text-2xl font-black">처리가 필요한 업무부터 확인하세요.</h2>
          </div>
          <Link className="inline-flex items-center gap-2 border border-paper/40 px-4 py-3 text-xs font-bold" href="/admin/operator/products/registration">
            상품 등록 <ArrowUpRight size={14} />
          </Link>
        </div>
        <div className="mt-6 grid gap-px bg-paper/20 sm:grid-cols-3">
          <Link className="bg-ink p-4" href="/admin/operator/orders"><span className="text-xs text-paper/70">확인할 주문·결제</span><strong className="mt-2 block font-mono text-3xl">{orders}</strong></Link>
          <Link className="bg-ink p-4" href="/admin/operator/shipping"><span className="text-xs text-paper/70">처리할 배송 요청</span><strong className="mt-2 block font-mono text-3xl">{shipping}</strong></Link>
          <Link className="bg-ink p-4" href="/admin/operator/products"><span className="text-xs text-paper/70">공개 중인 상품</span><strong className="mt-2 block font-mono text-3xl">{products.filter((product) => product.status === "active").length}</strong></Link>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
        {stats.map(([label, value, Icon]) => <div className="bg-paper p-5" key={label}><Icon size={17} /><p className="mt-7 text-xs text-muted">{label}</p><p className="mt-2 font-mono text-3xl font-bold">{value}</p></div>)}
      </div>
      <div className="flex justify-end">
        <Link className="inline-flex items-center gap-2 text-xs font-bold underline" href="/admin/operator/revenue">매출·정산 상세 보기 <ArrowUpRight size={14} /></Link>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[.75fr_1.25fr] lg:gap-10">
        <section className="border border-line bg-surface p-6">
          <p className="eyebrow text-muted">오늘 / 업무 목록</p>
          <div className="mt-7 space-y-5 text-xs">
            <Link className="flex gap-3 underline" href="/admin/operator/products/registration">새 상품 등록 <ArrowUpRight size={14} /></Link>
            <Link className="flex gap-3 underline" href="/admin/operator/orders">주문·결제 확인 <ArrowUpRight size={14} /></Link>
            <Link className="flex gap-3 underline" href="/admin/operator/fulfillment">출고·보관 업무 <ArrowUpRight size={14} /></Link>
            <Link className="flex gap-3 underline" href="/admin/operator/shipping">배송 요청·송장 입력 <ArrowUpRight size={14} /></Link>
            <Link className="flex gap-3 underline" href="/admin/operator/chat">회원 문의 확인 <ArrowUpRight size={14} /></Link>
          </div>
        </section>
        <section>
          <div className="mb-4 flex items-end justify-between border-b border-ink pb-4">
            <div>
              <p className="eyebrow text-muted">내 숍 / 상품</p>
              <h2 className="mt-2 text-xl font-black">내 숍 상품</h2>
            </div>
            <Link
              className="flex items-center gap-1 text-xs font-bold underline"
              href="/admin/operator/products"
            >
              전체 관리 <ArrowUpRight size={14} />
            </Link>
          </div>
          <div className="divide-y divide-line border-y border-line">
            {activeProducts.slice(0, 8).map((product) => (
              <div className="flex flex-wrap items-center gap-3 py-4 sm:gap-4" key={product.id}>
                <CatalogImage
                  alt=""
                  className="size-16 object-cover"
                  src={product.image_urls?.[0] ?? ""}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{product.title}</p>
                  <p className="mt-1 text-xs text-muted">
                    {product.sale_type === "fixed" ? "즉시구매" : "경매"} ·{" "}
                    {product.current_price.toLocaleString("ko-KR")}원
                  </p>
                </div>
                <span className={`border px-2 py-1 text-[10px] font-bold ${product.status === "closed" && product.pending_lock_kind ? "border-amber-300 bg-amber-50 text-amber-800" : "border-line"}`}>
                  {productStatusText(product)}
                </span>
                {canMutate &&
                  product.sale_type === "auction" &&
                  product.status === "closed" && (
                    <OperatorSecondChanceButton
                      onNotice={setNotice}
                      productId={product.id}
                      productTitle={product.title}
                    />
                  )}
              </div>
            ))}
            {activeProducts.length === 0 && (
              <p className="py-12 text-center text-sm text-muted">
                현재 진행 중인 상품이 없습니다.
              </p>
            )}
          </div>
        </section>

      </div>
    </div>
  );
}
