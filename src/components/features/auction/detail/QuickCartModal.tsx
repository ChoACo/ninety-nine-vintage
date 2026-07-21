"use client";

import { Check, ShoppingBag, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PremiumDialog } from "@/components/ui/PremiumDialog";

interface QuickCartModalProps {
  busy: boolean;
  completed: boolean;
  notice: string;
  onClose: () => void;
  onConfirm: () => void;
  onViewCart: () => void;
  open: boolean;
  price: number;
  productTitle: string;
}

export function QuickCartModal({
  busy,
  completed,
  notice,
  onClose,
  onConfirm,
  onViewCart,
  open,
  price,
  productTitle,
}: QuickCartModalProps) {
  return (
    <PremiumDialog closeDisabled={busy} labelledBy="quick-cart-title" onClose={onClose} open={open} panelClassName="max-w-lg">
      <header className="flex items-start justify-between gap-6 border-b border-line px-6 py-5">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[10px] font-bold tracking-[0.14em] text-muted"><ShoppingBag size={13} /> 쇼핑 흐름을 유지하는 간편 담기</p>
          <h2 className="mt-2 text-xl font-black leading-snug tracking-tight" id="quick-cart-title">{completed ? "장바구니에 담았어요" : "간편 장바구니"}</h2>
          <p className="mt-2 truncate text-xs text-muted">{productTitle}</p>
        </div>
        <button aria-label="간편 장바구니 닫기" className="grid size-10 shrink-0 place-items-center rounded-xl text-muted transition-all duration-300 hover:-translate-y-0.5 hover:bg-surface hover:text-ink active:scale-95 disabled:opacity-40" disabled={busy} onClick={onClose} type="button"><X size={19} /></button>
      </header>
      <div className="p-6">
        <div className="rounded-2xl border border-white/10 bg-surface p-5 shadow-sm">
          <p className="text-[10px] font-bold tracking-[0.12em] text-muted">판매 정가</p>
          <p className="mt-2 font-mono text-2xl font-black tracking-tight">{price.toLocaleString("ko-KR")}원</p>
          <p className="mt-3 text-xs leading-relaxed text-muted">담기 완료 시 15분 동안 재고를 안전하게 점유합니다. 현재 상세 화면은 그대로 유지됩니다.</p>
        </div>
        {notice && <p aria-live="polite" className={`mt-4 rounded-2xl border px-4 py-3 text-xs font-bold leading-relaxed shadow-sm ${completed ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>{completed && <Check className="mr-2 inline" size={14} />}{notice}</p>}
        <div className="mt-6 grid grid-cols-2 gap-2">
          <Button disabled={busy} onClick={onClose} type="button">{completed ? "계속 쇼핑" : "취소"}</Button>
          {completed ? <Button onClick={onViewCart} type="button" variant="primary">장바구니 보기</Button> : <Button disabled={busy} onClick={onConfirm} type="button" variant="primary">{busy ? "재고 확인 중" : "장바구니에 담기"}</Button>}
        </div>
      </div>
    </PremiumDialog>
  );
}
