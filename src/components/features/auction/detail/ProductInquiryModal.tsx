"use client";

import { MessageCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/FormControls";
import { PremiumDialog } from "@/components/ui/PremiumDialog";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface ProductInquiryModalProps {
  basePath?: "" | "/m";
  onClose: () => void;
  open: boolean;
  productId: string;
  productTitle: string;
}

export function ProductInquiryModal({
  basePath = "",
  onClose,
  open,
  productId,
  productTitle,
}: ProductInquiryModalProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = message.trim();
    if (!normalized || normalized.length > 2000 || busy) return;
    setBusy(true);
    setError("");
    try {
      const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
      if (!session?.access_token) {
        onClose();
        router.push(`${basePath}/account/login?next=${encodeURIComponent(`${basePath}/auction/${productId}`)}`);
        return;
      }
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          body: normalized,
          clientNonce: crypto.randomUUID(),
          productId,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        conversation?: { id?: string };
        error?: string;
      } | null;
      if (!response.ok || !payload?.conversation?.id) {
        throw new Error(payload?.error ?? "상품 문의를 보내지 못했습니다.");
      }
      onClose();
      router.push(`${basePath}/chat?conversationId=${encodeURIComponent(payload.conversation.id)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "상품 문의를 보내지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PremiumDialog closeDisabled={busy} labelledBy="product-inquiry-title" onClose={onClose} open={open} panelClassName="max-w-xl">
        <header className="flex items-start justify-between gap-6 border-b border-line px-6 py-5">
          <div className="min-w-0"><p className="flex items-center gap-2 text-[10px] font-bold tracking-[0.14em] text-muted"><MessageCircle size={13} /> 상품 상담</p><h2 className="mt-2 text-xl font-black tracking-[-0.04em]" id="product-inquiry-title">상품 문의</h2><p className="mt-2 truncate text-xs text-muted">{productTitle}</p></div>
          <button aria-label="상품 문의 닫기" className="grid size-10 shrink-0 place-items-center rounded-xl text-muted transition-all duration-300 hover:-translate-y-0.5 hover:bg-surface hover:text-ink active:scale-95 disabled:opacity-40" disabled={busy} onClick={onClose} type="button"><X size={19} /></button>
        </header>
        <form className="p-6" onSubmit={submit}>
          <label className="text-xs font-bold" htmlFor="product-inquiry-body">운영자에게 전달할 내용</label>
          <TextArea autoFocus className="mt-3 min-h-40 w-full resize-y leading-6" disabled={busy} id="product-inquiry-body" maxLength={2000} onChange={(event) => setMessage(event.target.value)} placeholder="사이즈, 상태, 배송 등 궁금한 점을 입력해 주세요." required value={message} />
          <div className="mt-2 flex justify-between text-[10px] text-muted"><span>상품 정보가 상담방에 함께 연결됩니다.</span><span className="font-mono">{message.length} / 2000</span></div>
          {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-bold text-red-700 shadow-sm" role="alert">{error}</p>}
          <div className="mt-6 grid grid-cols-2 gap-2"><Button disabled={busy} onClick={onClose} type="button">취소</Button><Button disabled={busy || !message.trim()} type="submit" variant="primary">{busy ? "전송 중" : "문의 보내고 상담방 열기"}</Button></div>
        </form>
    </PremiumDialog>
  );
}
