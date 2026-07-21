"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  Clock3,
  FileSpreadsheet,
  Package,
  Plus,
  Truck,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { OperatorSecondChanceButton } from "@/components/admin/operator/OperatorSecondChanceButton";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface Product {
  current_price: number;
  id: string;
  image_urls: string[];
  sale_type: string;
  status: string;
  title: string;
}

interface ProductResponse {
  permissions?: { canMutate?: boolean };
  products?: Product[];
}

function productStatusLabel(status: string) {
  if (status === "pending") return "공개 대기";
  if (status === "active") return "공개 중";
  if (status === "closed") return "마감";
  if (status === "sold") return "판매 완료";
  return status;
}

export function OperatorConsole() {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState(0);
  const [shipping, setShipping] = useState(0);
  const [members, setMembers] = useState(0);
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
        const [
          productResponse,
          orderResponse,
          shippingResponse,
          memberResponse,
        ] = await Promise.all([
          fetch("/api/admin/operator/products", { headers, cache: "no-store" }),
          fetch("/api/admin/operator/orders", { headers, cache: "no-store" }),
          fetch("/api/admin/operator/shipping", { headers, cache: "no-store" }),
          fetch("/api/admin/operator/members?limit=500", {
            headers,
            cache: "no-store",
          }),
        ]);
        const productData = await productResponse.json() as ProductResponse;
        const orderData = await orderResponse.json() as {
          transfers?: { status: string }[];
        };
        const shippingData = await shippingResponse.json() as {
          requests?: unknown[];
        };
        const memberData = await memberResponse.json() as {
          members?: unknown[];
        };
        if (!productResponse.ok) {
          throw new Error("운영자 권한을 확인할 수 없습니다.");
        }
        setProducts(productData.products ?? []);
        setCanMutate(productData.permissions?.canMutate === true);
        setOrders(
          orderData.transfers?.filter(
            (transfer) => transfer.status === "awaiting_transfer",
          ).length ?? 0,
        );
        setShipping(shippingData.requests?.length ?? 0);
        setMembers(memberData.members?.length ?? 0);
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
    ["입금 확인 대기", orders, Clock3],
    ["배송 요청", shipping, Truck],
    ["회원 디렉터리", members, Users],
  ] as const;

  return (
    <div className="space-y-10">
      <div className="flex flex-col items-stretch justify-between gap-5 border-b border-ink pb-7 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow text-muted">운영자 / 통합 현황</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-0.06em] sm:text-4xl sm:tracking-[-0.08em]">
            운영자 센터
          </h1>
          <p className="mt-3 text-sm text-muted">
            내 숍의 실제 상품·회원·주문·배송을 확인합니다.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Link
            className="flex items-center justify-center gap-2 border border-ink px-3 py-3 text-xs font-bold sm:px-5"
            href="/admin/operator/products?import=xlsx"
          >
            <FileSpreadsheet size={15} /> 엑셀 일괄 등록
          </Link>
          <Link
            className="flex items-center justify-center gap-2 bg-ink px-3 py-3 text-xs font-bold text-paper sm:px-5"
            href="/admin/operator/products"
          >
            <Plus size={15} /> 상품 등록
          </Link>
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

      <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
        {stats.map(([label, value, Icon]) => (
          <div className="bg-paper p-5" key={label}>
            <Icon size={17} />
            <p className="mt-7 text-xs text-muted">{label}</p>
            <p className="mt-2 font-mono text-3xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.25fr_.75fr] lg:gap-10">
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
            {products.slice(0, 8).map((product) => (
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
                <span className="border border-line px-2 py-1 text-[10px] font-bold">
                  {productStatusLabel(product.status)}
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
            {products.length === 0 && (
              <p className="py-12 text-center text-sm text-muted">
                등록된 상품이 없습니다.
              </p>
            )}
          </div>
        </section>

        <section className="border border-line bg-surface p-6">
          <p className="eyebrow text-muted">오늘 / 업무 목록</p>
          <div className="mt-7 space-y-5 text-xs">
            <Link
              className="flex gap-3 underline"
              href="/admin/operator/products"
            >
              상품 이미지와 실측 확인 <ArrowUpRight size={14} />
            </Link>
            <Link
              className="flex gap-3 underline"
              href="/admin/operator/members"
            >
              회원 상태·배송 이용권 관리 <ArrowUpRight size={14} />
            </Link>
            <Link
              className="flex gap-3 underline"
              href="/admin/operator/orders"
            >
              입금 확인 업무 열기 <ArrowUpRight size={14} />
            </Link>
            <Link
              className="flex gap-3 underline"
              href="/admin/operator/revenue"
            >
              확정 매출 집계 입력 <ArrowUpRight size={14} />
            </Link>
            <Link
              className="flex gap-3 underline"
              href="/admin/operator/shipping"
            >
              배송 요청 송장 입력 <ArrowUpRight size={14} />
            </Link>
            <Link
              className="flex gap-3 underline"
              href="/admin/operator/chat"
            >
              상담 메시지 답변 <ArrowUpRight size={14} />
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
