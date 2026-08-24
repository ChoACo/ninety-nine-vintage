"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageCircle, Megaphone, Pin, Plus, X } from "lucide-react";

import { useSupabaseSession } from "@/hooks/useSupabaseSession";

type Comment = { id: string; body: string; authorName: string; author_role: string; created_at: string };
type Post = { id: string; kind: "notice" | "discussion"; title: string; body: string; authorName: string; author_role: string; author_id: string | null; is_pinned: boolean; image_paths: string[]; created_at: string; comments: Comment[] };

const roleLabels: Record<string, string> = { owner: "사이트 소유자", operator: "운영자", employee: "직원" };

const guideCaptions: Record<string, string> = {
  "/guides/operator/product-registration-mobile/01-home-open-menu.png": "모바일 홈 왼쪽 위 전체 메뉴를 엽니다.",
  "/guides/operator/product-registration-mobile/02-select-work.png": "로그인 메뉴에서 업무를 선택합니다.",
  "/guides/operator/product-registration-mobile/03-open-operator-menu.png": "판매센터 상단의 업무 메뉴를 엽니다.",
  "/guides/operator/product-registration-mobile/04-new-product-menu.png": "상품 및 재고에서 새 상품 등록을 선택합니다.",
  "/guides/operator/product-registration-mobile/05-select-instant-purchase.png": "즉시구매 상품 등록을 선택합니다.",
  "/guides/operator/product-registration-mobile/06-upload-product-photo.png": "대표 사진을 포함해 상품 사진을 올립니다.",
  "/guides/operator/product-registration-mobile/08-price-storage-defects.png": "상품명, 카테고리와 실측 정보를 입력합니다.",
  "/guides/operator/product-registration-mobile/07-product-info-measurements.png": "가격, 설명, 보관 크기와 하자 여부를 확인합니다.",
  "/guides/operator/product-registration-mobile/09-publish-and-submit.png": "공개 방식을 확인한 뒤 등록 버튼을 누릅니다.",
  "/guides/operator/product-registration-mobile/10-registration-complete.png": "등록 완료 안내가 표시되면 상품 목록에서 다시 확인합니다.",
  "/guides/operator/product-registration-pc/02-new-product-menu.png": "PC 홈 상단에서 업무를 선택합니다.",
  "/guides/operator/product-registration-pc/03-select-instant-purchase.png": "새 상품 등록 메뉴에서 즉시구매 등록 화면으로 이동합니다.",
  "/guides/operator/product-registration-pc/04-upload-product-photo.png": "대표 사진을 포함해 상품 사진을 올립니다.",
  "/guides/operator/product-registration-pc/06-price-storage-defects.png": "상품 정보, 가격, 설명, 보관 크기와 하자 여부를 확인합니다.",
  "/guides/operator/product-registration-pc/08-registration-complete.png": "등록 완료 안내가 표시되면 상품 목록에서 다시 확인합니다.",
  "/guides/buyer/live-auction/01-open-live-auction.png": "모바일 홈에서 라이브 옥션으로 이동합니다.",
  "/guides/buyer/live-auction/02-select-auction-product.png": "참여할 경매 상품의 경매 참여를 선택합니다.",
  "/guides/buyer/live-auction/03-set-bid-amount.png": "입찰 금액을 정하고 취소 불가 약관을 확인합니다.",
  "/guides/buyer/live-auction/04-confirm-final-bid.png": "최종 입찰 금액을 다시 확인한 뒤 입찰을 확정합니다.",
  "/guides/buyer/live-auction/05-bid-success.png": "내 입찰 반영 여부와 현재 최고가를 확인합니다.",
  "/guides/buyer/live-auction/06-review-winning-item.png": "경매 종료 후 MY 결제하기에서 낙찰 상품과 금액을 확인합니다.",
  "/guides/buyer/live-auction/07-enter-depositor.png": "입금자명을 입력하고 상품 금액과 배송비를 확인합니다.",
  "/guides/buyer/live-auction/08-bank-transfer-info.png": "안내된 계좌, 입금자명, 총액과 결제 마감을 확인해 한 번만 입금합니다.",
  "/guides/buyer/live-auction/09-vault-storage-period.png": "입금 확인 후 보관함에서 상품과 남은 무료 보관 기간을 확인합니다.",
  "/guides/buyer/live-auction/10-request-shipping.png": "보낼 상품과 배송지를 선택한 뒤 배송을 신청합니다.",
  "/guides/buyer/live-auction/11-shipping-request-success.png": "배송 접수 완료 안내를 확인하고 이후 배송 현황에서 진행 상태를 확인합니다.",
  "/guides/buyer/archive-cart/01-select-product.png": "아카이브숍에서 상태와 가격을 보고 원하는 상품을 선택합니다.",
  "/guides/buyer/archive-cart/02-add-to-cart.png": "상세 화면에서 상품 상태와 보관 안내를 확인하고 장바구니에 담습니다.",
  "/guides/buyer/archive-cart/03-choose-immediate-shipping.png": "장바구니에서 즉시 발송과 배송지를 확인합니다.",
  "/guides/buyer/archive-cart/04-review-and-pay.png": "상품 금액, 배송비, 최종 결제액과 필수 약관을 확인하고 결제합니다.",
  "/guides/buyer/archive-cart/05-bank-transfer-order.png": "생성된 주문번호와 안내 계좌를 확인해 정확한 금액을 입금합니다.",
  "/guides/buyer/archive-cart/06-order-paid-shipping.png": "MY 주문 내역에서 결제 완료와 배송 접수 상태를 확인합니다.",
};

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value));
}

export function StaffBoard() {
  const { session } = useSupabaseSession();
  const token = session?.access_token ?? null;
  const [posts, setPosts] = useState<Post[]>([]);
  const [roleCode, setRoleCode] = useState("");
  const [tab, setTab] = useState<"notice" | "discussion">("notice");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const response = await fetch("/api/admin/staff-board", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) return setMessage(payload.message ?? "게시판을 불러오지 못했습니다.");
    setPosts(payload.posts ?? []);
    setRoleCode(payload.roleCode ?? "");
    setSelectedId((current) => current ?? payload.posts?.[0]?.id ?? null);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load, token]);

  const filtered = useMemo(() => posts.filter((post) => post.kind === tab), [posts, tab]);
  const selected = posts.find((post) => post.id === selectedId && post.kind === tab) ?? filtered[0] ?? null;

  async function submit(payload: Record<string, unknown>) {
    if (!token || busy) return;
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/admin/staff-board", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(result.message ?? "등록하지 못했습니다.");
    setTitle(""); setBody(""); setComment(""); setComposerOpen(false);
    await load();
    setMessage("등록했습니다.");
  }

  return <div className="space-y-5" data-testid="staff-board">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="eyebrow text-muted">OPERATIONS HUB</p><h1 className="mt-2 text-2xl font-black tracking-[-.05em]">공지·커뮤니케이션</h1><p className="mt-2 text-sm text-muted">운영 안내를 확인하고 사이트 소유자·운영자·직원이 함께 질문과 답변을 나눕니다.</p></div>
      <button className="inline-flex min-h-11 items-center gap-2 bg-ink px-4 text-xs font-black text-paper" onClick={() => setComposerOpen(true)} type="button"><Plus size={15} /> 글쓰기</button>
    </header>
    <div className="grid grid-cols-2 border border-line bg-surface p-1" role="tablist">
      {(["notice", "discussion"] as const).map((item) => <button aria-selected={tab === item} className={`min-h-11 text-sm font-black ${tab === item ? "bg-ink text-paper" : "text-muted"}`} key={item} onClick={() => { setTab(item); setSelectedId(null); }} role="tab" type="button">{item === "notice" ? "공지사항" : "커뮤니케이션"}</button>)}
    </div>
    {message && <p className="border border-line bg-surface px-4 py-3 text-xs font-bold" role="status">{message}</p>}
    <div className="grid min-h-[520px] border border-line lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="border-b border-line bg-surface lg:border-b-0 lg:border-r">
        {filtered.length ? filtered.map((post) => <button className={`block w-full border-b border-line p-4 text-left ${selected?.id === post.id ? "bg-paper" : "hover:bg-paper/70"}`} key={post.id} onClick={() => setSelectedId(post.id)} type="button"><span className="flex items-center gap-2 text-[10px] font-black text-muted">{post.is_pinned && <Pin size={11} />} {roleLabels[post.author_role]} · {dateLabel(post.created_at)}</span><strong className="mt-2 block text-sm">{post.title}</strong><span className="mt-2 flex items-center gap-1 text-[10px] text-muted"><MessageCircle size={11} /> 답변 {post.comments.length}</span></button>) : <p className="p-6 text-sm text-muted">등록된 글이 없습니다.</p>}
      </aside>
      <article className="min-w-0 p-5 sm:p-7">
        {selected ? <><div className="border-b border-line pb-5"><div className="flex items-center gap-2 text-[10px] font-black text-muted">{selected.kind === "notice" ? <Megaphone size={13} /> : <MessageCircle size={13} />} {selected.authorName} · {roleLabels[selected.author_role]} · {dateLabel(selected.created_at)}</div><h2 className="mt-3 text-xl font-black">{selected.title}</h2></div><div className="whitespace-pre-wrap py-6 text-sm leading-7">{selected.body}</div>{selected.image_paths.length > 0 && <div className="space-y-4 border-t border-line pt-6"><h3 className="text-xs font-black">화면 따라하기</h3>{selected.image_paths.map((path, index) => { const caption = guideCaptions[path] ?? `${index + 1}단계 화면`; const isBuyerGuide = path.startsWith("/guides/buyer/"); return <figure className={`overflow-hidden border bg-surface p-2 ${isBuyerGuide ? "border-4 border-red-500" : "border-line"}`} key={path}><Image alt={caption} className="h-auto w-full" height={900} priority={index === 0} sizes="(max-width: 1024px) 100vw, 760px" src={path} width={1440} /><figcaption className={`px-2 py-2 text-[10px] font-bold ${isBuyerGuide ? "text-red-700" : "text-muted"}`}>{index + 1}. {caption}</figcaption></figure>; })}</div>}<section className="mt-8 border-t border-line pt-5"><h3 className="text-sm font-black">답변 {selected.comments.length}</h3><div className="mt-3 space-y-2">{selected.comments.map((item) => <div className="bg-surface p-3 text-xs" key={item.id}><p className="font-black">{item.authorName} · {roleLabels[item.author_role]}</p><p className="mt-2 whitespace-pre-wrap leading-5">{item.body}</p></div>)}</div><div className="mt-3 flex gap-2"><label className="sr-only" htmlFor="staff-board-comment">답변 내용</label><input className="min-h-11 min-w-0 flex-1 border border-line bg-paper px-3 text-xs" id="staff-board-comment" maxLength={2000} onChange={(event) => setComment(event.target.value)} placeholder="질문에 답변하거나 추가 내용을 남겨 주세요" value={comment} /><button className="bg-ink px-4 text-xs font-black text-paper disabled:opacity-40" disabled={busy || !comment.trim()} onClick={() => void submit({ action: "create_comment", postId: selected.id, body: comment })} type="button">답변 등록</button></div></section></> : <div className="grid h-full place-items-center text-sm text-muted">왼쪽에서 글을 선택해 주세요.</div>}
      </article>
    </div>
    {composerOpen && <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-ink/45 p-4" role="dialog"><div className="w-full max-w-xl border border-line bg-paper p-5 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-lg font-black">새 글 작성</h2><button aria-label="닫기" onClick={() => setComposerOpen(false)} type="button"><X /></button></div><div className="mt-5 space-y-3"><label className="block text-xs font-black">게시판<select className="mt-1 min-h-11 w-full border border-line bg-paper px-3" onChange={(event) => setTab(event.target.value as typeof tab)} value={tab}><option value="discussion">커뮤니케이션</option>{roleCode === "owner" && <option value="notice">공지사항</option>}</select></label><label className="block text-xs font-black">제목<input className="mt-1 min-h-11 w-full border border-line bg-paper px-3" maxLength={120} onChange={(event) => setTitle(event.target.value)} value={title} /></label><label className="block text-xs font-black">내용<textarea className="mt-1 min-h-48 w-full border border-line bg-paper p-3 leading-6" maxLength={10000} onChange={(event) => setBody(event.target.value)} value={body} /></label><button className="min-h-11 w-full bg-ink text-sm font-black text-paper disabled:opacity-40" disabled={busy || title.trim().length < 2 || body.trim().length < 2} onClick={() => void submit({ action: "create_post", kind: tab, title, body, isPinned: tab === "notice" })} type="button">등록하기</button></div></div></div>}
  </div>;
}
