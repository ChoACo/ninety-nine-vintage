"use client";

import { RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { OperatorSecondChanceButton } from "@/components/admin/operator/OperatorSecondChanceButton";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusNotice } from "@/components/ui/StatusNotice";

interface PastProduct {
  id: string;
  title: string;
  current_price: number;
  image_urls: string[];
  store_id: string | null;
  past_at: string | null;
  past_expires_at: string | null;
  stores?: { name: string } | null;
}

interface ClosedAuction {
  closes_at: string;
  current_price: number;
  id: string;
  image_urls: string[];
  store_id: string | null;
  stores?: { name: string } | null;
  title: string;
}

export function OperatorPastProductsConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [products, setProducts] = useState<PastProduct[]>([]);
  const [closedAuctions, setClosedAuctions] = useState<ClosedAuction[]>([]);
  const [canProcessSecondChance, setCanProcessSecondChance] = useState(false);
  const [paymentMode, setPaymentMode] = useState<
    "manual_transfer" | "portone" | null
  >(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async (accessToken: string | null) => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const response = await fetch("/api/admin/operator/products/past", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        canProcessSecondChance?: boolean;
        closedAuctions?: ClosedAuction[];
        error?: string;
        paymentMode?: "manual_transfer" | "portone" | null;
        products?: PastProduct[];
      };
      if (!response.ok)
        throw new Error(payload.error ?? "지난 상품을 불러오지 못했습니다.");
      setProducts(payload.products ?? []);
      setClosedAuctions(payload.closedAuctions ?? []);
      setCanProcessSecondChance(payload.canProcessSecondChance === true);
      setPaymentMode(payload.paymentMode ?? null);
      setSelected((current) =>
        current.filter((id) =>
          (payload.products ?? []).some((product) => product.id === id),
        ),
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "지난 상품을 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const session = (await getSupabaseBrowserClient().auth.getSession()).data
        .session;
      setToken(session?.access_token ?? null);
      await load(session?.access_token ?? null);
    })().catch((error) =>
      setNotice(
        error instanceof Error
          ? error.message
          : "운영자 세션을 확인하지 못했습니다.",
      ),
    );
  }, [load]);

  const allSelected =
    products.length > 0 && selected.length === products.length;
  const expiryLabel = useMemo(
    () => (value: string | null) =>
      value ? new Date(value).toLocaleString("ko-KR") : "-",
    [],
  );

  const toggleAll = () =>
    setSelected(allSelected ? [] : products.map((product) => product.id));
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );

  const act = async (action: "relist" | "delete") => {
    if (!token || busy || selected.length === 0) return;
    if (
      action === "delete" &&
      !window.confirm(
        `${selected.length}개 지난 상품을 삭제할까요? 입찰·주문 이력이 있으면 보존됩니다.`,
      )
    )
      return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/operator/products/past", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ productIds: selected, action }),
      });
      const payload = (await response.json()) as {
        error?: string;
        result?: { processed_count?: number; skipped_count?: number };
      };
      if (!response.ok)
        throw new Error(payload.error ?? "지난 상품을 처리하지 못했습니다.");
      setNotice(
        `${payload.result?.processed_count ?? 0}개 처리 완료 · ${payload.result?.skipped_count ?? 0}개 보존 또는 건너뜀`,
      );
      await load(token);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "지난 상품을 처리하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <SectionHeading
        action={
          <Button
            className="flex items-center gap-2"
            disabled={loading}
            onClick={() => void load(token)}
            type="button"
          >
            <RefreshCw size={13} /> 새로고침
          </Button>
        }
        description="담당 숍의 모든 마감 경매에서 차순위 낙찰을 검토하고, 미낙찰 지난 상품을 재등록하거나 삭제합니다."
        eyebrow="운영자 / 지난 경매"
        title="마감 경매 관리"
        variant="page"
      />
      {notice && <StatusNotice>{notice}</StatusNotice>}
      <section className="space-y-4">
        <div className="border-b border-ink pb-4">
          <p className="eyebrow text-muted">마감 경매 / 차순위 낙찰</p>
          <h2 className="mt-2 text-xl font-black">차순위 낙찰 제안</h2>
          <p className="mt-2 text-xs leading-5 text-muted">
            최근 8개 제한 없이 담당 숍의 모든 마감 경매를 표시합니다. 실제 제안
            시 서버가 담당 숍, 원 낙찰자의 결제 기한, 중복 제안과 감사 원장을
            다시 검증합니다.
          </p>
          {paymentMode === "portone" && (
            <StatusNotice className="mt-3">
              현재 PortOne 운영 모드입니다. 차순위 낙찰 수락·결제 경로는
              계좌이체 전용이므로 운영 모드를 바꾸기 전에는 제안할 수 없습니다.
            </StatusNotice>
          )}
        </div>
        <div className="divide-y divide-line border-y border-line">
          {closedAuctions.map((product) => (
            <article
              className="flex flex-wrap items-center gap-3 px-3 py-5 sm:flex-nowrap sm:gap-4 sm:px-4"
              key={product.id}
            >
              <CatalogImage
                alt=""
                className="size-16 object-cover"
                src={product.image_urls?.[0] ?? ""}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">
                  {product.title}
                </span>
                <span className="mt-1 block text-xs text-muted">
                  {product.stores?.name ?? "미지정 숍"} ·{" "}
                  {product.current_price.toLocaleString("ko-KR")}원
                </span>
                <span className="mt-1 block text-[10px] text-muted">
                  마감 {expiryLabel(product.closes_at)}
                </span>
              </span>
              {canProcessSecondChance && paymentMode === "manual_transfer" ? (
                <OperatorSecondChanceButton
                  onNotice={setNotice}
                  productId={product.id}
                  productTitle={product.title}
                />
              ) : (
                <span className="text-[10px] font-bold text-muted">
                  {paymentMode === "portone"
                    ? "계좌이체 모드에서 사용"
                    : "처리 권한 없음"}
                </span>
              )}
            </article>
          ))}
          {closedAuctions.length === 0 && (
            <div className="py-16 text-center text-sm text-muted">
              현재 마감된 경매가 없습니다.
            </div>
          )}
        </div>
      </section>
      <section className="space-y-4">
        <div className="border-b border-ink pb-4">
          <p className="eyebrow text-muted">미낙찰 / 보존 기간</p>
          <h2 className="mt-2 text-xl font-black">지난 상품 정리</h2>
          <p className="mt-2 text-xs leading-5 text-muted">
            7일이 지난 미낙찰 경매는 최대 3일 동안 재등록하거나 삭제할 수
            있습니다.
          </p>
        </div>
        <div className="flex flex-col items-start justify-between gap-3 border-y border-line py-4 text-xs sm:flex-row sm:items-center">
          <label className="flex items-center gap-2 font-bold">
            <input checked={allSelected} onChange={toggleAll} type="checkbox" />{" "}
            전체 선택{" "}
            <span className="text-muted">
              ({selected.length}/{products.length})
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              className="flex items-center gap-2 text-xs"
              disabled={busy || selected.length === 0}
              size="compact"
              variant="outline"
              onClick={() => void act("relist")}
              type="button"
            >
              <RotateCcw size={13} /> 선택 재등록
            </Button>
            <Button
              className="flex items-center gap-2 text-xs"
              disabled={busy || selected.length === 0}
              size="compact"
              variant="danger"
              onClick={() => void act("delete")}
              type="button"
            >
              <Trash2 size={13} /> 선택 삭제
            </Button>
          </div>
        </div>
        <div className="divide-y divide-line border-y border-line">
          {products.map((product) => (
            <label
              className="flex cursor-pointer flex-wrap items-center gap-3 px-3 py-5 sm:flex-nowrap sm:gap-4 sm:px-4"
              key={product.id}
            >
              <input
                checked={selected.includes(product.id)}
                onChange={() => toggle(product.id)}
                type="checkbox"
              />
              <CatalogImage
                alt=""
                className="size-16 object-cover"
                src={product.image_urls?.[0] ?? ""}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">
                  {product.title}
                </span>
                <span className="mt-1 block text-xs text-muted">
                  {product.stores?.name ?? "미지정 숍"} ·{" "}
                  {product.current_price.toLocaleString("ko-KR")}원
                </span>
              </span>
              <span className="w-full pl-24 text-left text-[10px] text-muted sm:w-auto sm:pl-0 sm:text-right">
                <span className="block">
                  지난 시각 {expiryLabel(product.past_at)}
                </span>
                <span className="mt-1 block text-amber-700">
                  자동 삭제 {expiryLabel(product.past_expires_at)}
                </span>
              </span>
            </label>
          ))}
          {products.length === 0 && (
            <div className="py-20 text-center text-sm text-muted">
              현재 처리할 지난 상품이 없습니다.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
