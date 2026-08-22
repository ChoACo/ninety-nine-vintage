"use client";

import { Heart, MessageCircle, Share2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export function CenterStorefrontActions({ chatHref, name, storeId }: { chatHref: string; name: string; storeId: string }) {
  const storageKey = `ninety-nine:center-follow:${storeId}`; const [followed, setFollowed] = useState(false); const [notice, setNotice] = useState("");
  const toggle = () => setFollowed((current) => { const next = !current; window.localStorage.setItem(storageKey, next ? "1" : "0"); return next; });
  const share = async () => { const url = window.location.href; try { if (navigator.share) await navigator.share({ title: `${name} 센터몰`, url }); else { await navigator.clipboard.writeText(url); setNotice("센터 링크를 복사했습니다."); } } catch { setNotice("공유를 취소했거나 링크를 복사하지 못했습니다."); } };
  return <div className="mt-7 flex flex-wrap gap-3"><button aria-pressed={followed} className={`inline-flex min-h-12 items-center gap-2 rounded-xl px-5 text-xs font-black ${followed ? "bg-rose-500 text-white" : "bg-ink text-paper"}`} onClick={toggle} type="button"><Heart fill={followed ? "currentColor" : "none"} size={15} />{followed ? "단골 등록됨" : "단골 등록"}</button><Link className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line px-5 text-xs font-black" href={chatHref}><MessageCircle size={15} />센터 1:1 문의</Link><button className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line px-5 text-xs font-black" onClick={() => void share()} type="button"><Share2 size={15} />공유</button>{notice && <span aria-live="polite" className="w-full text-[10px] text-muted">{notice}</span>}</div>;
}
