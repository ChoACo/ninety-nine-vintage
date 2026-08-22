"use client";

import { Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { ImageAttachmentPicker, uploadSupportImages, type PendingSupportImage } from "@/components/features/chat/ImageAttachmentPicker";

interface StoreOption { id: string; name: string }
interface BidOption { productId: string; title: string }
const categories = ["경매/입찰 관련", "보관함 및 묶음 배송", "주문/결제/환불", "상품 상태 및 실측 상세", "기타 문의"] as const;

export function InquiryForm({ onCreated }: { onCreated?: () => void }) {
  const { session } = useSupabaseSession();
  const token = session?.access_token;
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [bids, setBids] = useState<BidOption[]>([]);
  const [category, setCategory] = useState("");
  const [storeId, setStoreId] = useState("");
  const [productId, setProductId] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [images, setImages] = useState<PendingSupportImage[]>([]);

  useEffect(() => {
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    const controller = new AbortController();
    void Promise.all([
      fetch("/api/chat", { headers, cache: "no-store", signal: controller.signal }).then((response) => response.ok ? response.json() as Promise<{ stores?: StoreOption[] }> : { stores: [] }),
      fetch("/api/account/bids", { headers, cache: "no-store", signal: controller.signal }).then((response) => response.ok ? response.json() as Promise<{ items?: BidOption[] }> : { items: [] }),
    ]).then(([chat, bid]) => {
      setStores(chat.stores ?? []);
      setBids(bid.items ?? []);
      setStoreId((current) => current || chat.stores?.[0]?.id || "");
    }).catch(() => undefined);
    return () => controller.abort();
  }, [token]);

  const submit = async () => {
    if (!token || busy) return;
    if (!category) { setNotice("문의 유형을 선택해 주세요."); return; }
    if (title.trim().length < 5) { setNotice("제목을 5자 이상 입력해 주세요."); return; }
    if (content.trim().length < 10) { setNotice("문의 내용을 10자 이상 입력해 주세요."); return; }
    if (!productId && !storeId) { setNotice("문의할 매장을 선택해 주세요."); return; }
    setBusy(true);
    setNotice("");
    try {
      const body = `[문의 유형] ${category}\n[문의 제목] ${title.trim()}\n\n${content.trim()}`;
      const response = await fetch("/api/chat", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ body, clientNonce: crypto.randomUUID(), productId: productId || undefined, storeId: productId ? undefined : storeId }) });
      const payload = await response.json().catch(() => null) as { error?: string; message?: { id: string }; conversation?: { id: string } } | null;
      if (!response.ok || !payload?.message?.id || !payload.conversation?.id) throw new Error(typeof payload?.message === "string" ? payload.message : payload?.error ?? "문의를 접수하지 못했습니다.");
      if (images.length > 0) await uploadSupportImages({ token, conversationId: payload.conversation.id, messageId: payload.message.id, images });
      setCategory(""); setProductId(""); setTitle(""); setContent("");
      setImages([]);
      setNotice("문의가 접수되었습니다. 답변은 MY 문의 내역과 알림으로 안내합니다.");
      onCreated?.();
    } catch (error) { setNotice(error instanceof Error ? error.message : "문의를 접수하지 못했습니다."); }
    finally { setBusy(false); }
  };

  if (!session) return <div className="rounded-2xl border border-line bg-surface p-6 text-sm">로그인 후 1:1 문의를 작성할 수 있습니다.</div>;
  return <section className="rounded-3xl border border-line bg-paper p-5 shadow-sm sm:p-7">
    <div><p className="eyebrow text-muted">1:1 고객 문의</p><h2 className="mt-2 text-2xl font-black">문의 작성</h2><p className="mt-2 text-xs leading-5 text-muted">문의는 선택한 매장 상담 원장에 안전하게 기록됩니다.</p></div>
    <div className="mt-6 grid gap-4 sm:grid-cols-2">
      <label className="grid gap-2 text-xs font-bold">문의 유형<select className="h-12 rounded-xl border border-line bg-paper px-3 font-normal" onChange={(event) => setCategory(event.target.value)} value={category}><option value="">선택해 주세요</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="grid gap-2 text-xs font-bold">문의 매장<select className="h-12 rounded-xl border border-line bg-paper px-3 font-normal" disabled={Boolean(productId)} onChange={(event) => setStoreId(event.target.value)} value={storeId}><option value="">매장 선택</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
      <label className="grid gap-2 text-xs font-bold sm:col-span-2">관련 경매 상품 선택 (선택)<select className="h-12 rounded-xl border border-line bg-paper px-3 font-normal" onChange={(event) => setProductId(event.target.value)} value={productId}><option value="">연결하지 않음</option>{bids.map((bid) => <option key={bid.productId} value={bid.productId}>{bid.title}</option>)}</select></label>
      <label className="grid gap-2 text-xs font-bold sm:col-span-2">제목<input className="h-12 rounded-xl border border-line bg-paper px-4 font-normal outline-none focus:border-ink" maxLength={100} onChange={(event) => setTitle(event.target.value)} placeholder="5자 이상 입력해 주세요" value={title} /></label>
      <label className="grid gap-2 text-xs font-bold sm:col-span-2">문의 내용<textarea className="min-h-40 rounded-xl border border-line bg-paper p-4 font-normal leading-6 outline-none focus:border-ink" maxLength={2_000} onChange={(event) => setContent(event.target.value)} placeholder="10자 이상 자세히 적어주세요." value={content} /></label>
      <div className="sm:col-span-2"><ImageAttachmentPicker disabled={busy} images={images} maxCount={3} onChange={setImages} onError={setNotice} /></div>
    </div>
    <p className="mt-4 rounded-xl border border-line bg-surface p-3 text-[11px] leading-5 text-muted">첨부 사진은 비공개로 저장되며 해당 문의의 고객과 담당자만 확인할 수 있습니다.</p>
    {notice && <p aria-live="polite" className="mt-4 text-xs font-bold">{notice}</p>}
    <button className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink px-5 text-sm font-bold text-paper disabled:opacity-40" disabled={busy} onClick={() => void submit()} type="button"><Send size={15} />{busy ? "접수 중…" : "문의 접수하기"}</button>
  </section>;
}
