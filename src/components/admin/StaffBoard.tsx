"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageCircle, Megaphone, Pin, Plus, X } from "lucide-react";

import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { GUIDE_IMAGE_CAPTIONS } from "@/lib/notices/memberGuideNotices";

type Comment = { id: string; body: string; authorName: string; author_role: string; created_at: string };
type Post = { id: string; kind: "notice" | "discussion"; title: string; body: string; authorName: string; author_role: string; author_id: string | null; is_pinned: boolean; image_paths: string[]; created_at: string; comments: Comment[] };

const roleLabels: Record<string, string> = { owner: "사이트 소유자", operator: "운영자", employee: "직원" };

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
        {selected ? <><div className="border-b border-line pb-5"><div className="flex items-center gap-2 text-[10px] font-black text-muted">{selected.kind === "notice" ? <Megaphone size={13} /> : <MessageCircle size={13} />} {selected.authorName} · {roleLabels[selected.author_role]} · {dateLabel(selected.created_at)}</div><h2 className="mt-3 text-xl font-black">{selected.title}</h2></div><div className="whitespace-pre-wrap py-6 text-sm leading-7">{selected.body}</div>{selected.image_paths.length > 0 && <div className="space-y-4 border-t border-line pt-6"><h3 className="text-xs font-black">화면 따라하기</h3>{selected.image_paths.map((path, index) => { const caption = GUIDE_IMAGE_CAPTIONS[path] ?? `${index + 1}단계 화면`; const isBuyerGuide = path.startsWith("/guides/buyer/"); return <figure className={`overflow-hidden border bg-surface p-2 ${isBuyerGuide ? "border-4 border-red-500" : "border-line"}`} key={path}><Image alt={caption} className="h-auto w-full" height={900} priority={index === 0} sizes="(max-width: 1024px) 100vw, 760px" src={path} width={1440} /><figcaption className={`px-2 py-2 text-[10px] font-bold ${isBuyerGuide ? "text-red-700" : "text-muted"}`}>{index + 1}. {caption}</figcaption></figure>; })}</div>}<section className="mt-8 border-t border-line pt-5"><h3 className="text-sm font-black">답변 {selected.comments.length}</h3><div className="mt-3 space-y-2">{selected.comments.map((item) => <div className="bg-surface p-3 text-xs" key={item.id}><p className="font-black">{item.authorName} · {roleLabels[item.author_role]}</p><p className="mt-2 whitespace-pre-wrap leading-5">{item.body}</p></div>)}</div><div className="mt-3 flex gap-2"><label className="sr-only" htmlFor="staff-board-comment">답변 내용</label><input className="min-h-11 min-w-0 flex-1 border border-line bg-paper px-3 text-xs" id="staff-board-comment" maxLength={2000} onChange={(event) => setComment(event.target.value)} placeholder="질문에 답변하거나 추가 내용을 남겨 주세요" value={comment} /><button className="bg-ink px-4 text-xs font-black text-paper disabled:opacity-40" disabled={busy || !comment.trim()} onClick={() => void submit({ action: "create_comment", postId: selected.id, body: comment })} type="button">답변 등록</button></div></section></> : <div className="grid h-full place-items-center text-sm text-muted">왼쪽에서 글을 선택해 주세요.</div>}
      </article>
    </div>
    {composerOpen && <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-ink/45 p-4" role="dialog"><div className="w-full max-w-xl border border-line bg-paper p-5 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-lg font-black">새 글 작성</h2><button aria-label="닫기" onClick={() => setComposerOpen(false)} type="button"><X /></button></div><div className="mt-5 space-y-3"><label className="block text-xs font-black">게시판<select className="mt-1 min-h-11 w-full border border-line bg-paper px-3" onChange={(event) => setTab(event.target.value as typeof tab)} value={tab}><option value="discussion">커뮤니케이션</option>{roleCode === "owner" && <option value="notice">공지사항</option>}</select></label><label className="block text-xs font-black">제목<input className="mt-1 min-h-11 w-full border border-line bg-paper px-3" maxLength={120} onChange={(event) => setTitle(event.target.value)} value={title} /></label><label className="block text-xs font-black">내용<textarea className="mt-1 min-h-48 w-full border border-line bg-paper p-3 leading-6" maxLength={10000} onChange={(event) => setBody(event.target.value)} value={body} /></label><button className="min-h-11 w-full bg-ink text-sm font-black text-paper disabled:opacity-40" disabled={busy || title.trim().length < 2 || body.trim().length < 2} onClick={() => void submit({ action: "create_post", kind: tab, title, body, isPinned: tab === "notice" })} type="button">등록하기</button></div></div></div>}
  </div>;
}
