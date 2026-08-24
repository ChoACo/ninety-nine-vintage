"use client";

import Image from "next/image";
import { BookOpen, Megaphone } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import {
  GUIDE_IMAGE_CAPTIONS,
  type MemberGuideNotice,
} from "@/lib/notices/memberGuideNotices";

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

export function MemberNoticeBoard() {
  const { session } = useSupabaseSession();
  const token = session?.access_token ?? null;
  const [notices, setNotices] = useState<MemberGuideNotice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!token) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/account/notices", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as {
        notices?: MemberGuideNotice[];
        message?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.message ?? "공지사항을 불러오지 못했습니다.");
      }
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      const nextNotices = payload?.notices ?? [];
      setNotices(nextNotices);
      setSelectedId((current) =>
        current && nextNotices.some((notice) => notice.id === current)
          ? current
          : nextNotices[0]?.id ?? null,
      );
    } catch (error) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setMessage(
        error instanceof Error
          ? error.message
          : "공지사항을 불러오지 못했습니다.",
      );
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [token]);

  useEffect(() => {
    mountedRef.current = true;
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      window.clearTimeout(timeoutId);
    };
  }, [load]);

  const selected = useMemo(
    () =>
      notices.find((notice) => notice.id === selectedId) ?? notices[0] ?? null,
    [notices, selectedId],
  );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 pb-28 sm:pb-12" data-testid="member-notice-board">
      <header className="rounded-3xl border border-line bg-paper p-5 sm:p-8">
        <p className="eyebrow text-muted">MEMBER GUIDE</p>
        <div className="mt-3 flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-ink text-paper">
            <Megaphone aria-hidden="true" size={20} />
          </span>
          <div className="min-w-0">
            <h1 className="break-keep text-2xl font-black tracking-[-.06em] sm:text-4xl">
              공지사항 · 이용 가이드
            </h1>
            <p className="mt-2 break-keep text-xs leading-6 text-muted sm:text-sm">
              상품 등록부터 입찰·구매·보관·배송까지 화면을 보며 순서대로 따라오세요.
            </p>
          </div>
        </div>
      </header>

      {message && (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm font-bold text-red-800" role="alert">
          <p>{message}</p>
          <button className="mt-3 min-h-11 rounded-xl border border-red-300 px-4 text-xs" onClick={() => void load()} type="button">
            다시 불러오기
          </button>
        </div>
      )}

      {loading ? (
        <div className="grid min-h-[360px] place-items-center rounded-3xl border border-line bg-paper text-sm text-muted" role="status">
          공지사항을 불러오고 있습니다.
        </div>
      ) : notices.length === 0 ? (
        <div className="grid min-h-[360px] place-items-center rounded-3xl border border-line bg-paper p-6 text-center">
          <div>
            <BookOpen className="mx-auto text-muted" size={30} />
            <p className="mt-3 text-sm font-bold">등록된 이용 가이드가 없습니다.</p>
          </div>
        </div>
      ) : (
        <div className="grid min-w-0 overflow-hidden rounded-3xl border border-line bg-paper lg:grid-cols-[320px_minmax(0,1fr)]">
          <nav aria-label="이용 가이드 목록" className="border-b border-line bg-surface p-2 lg:border-b-0 lg:border-r">
            <div className="flex snap-x gap-2 overflow-x-auto overscroll-contain lg:grid lg:overflow-visible">
              {notices.map((notice, index) => {
                const active = selected?.id === notice.id;
                return (
                  <button
                    aria-current={active ? "page" : undefined}
                    className={`min-h-14 w-[78vw] max-w-[280px] shrink-0 snap-start rounded-2xl border p-4 text-left transition-colors lg:w-full lg:max-w-none ${active ? "border-ink bg-paper text-ink" : "border-transparent text-muted hover:border-line hover:bg-paper/70"}`}
                    key={notice.id}
                    onClick={() => setSelectedId(notice.id)}
                    type="button"
                  >
                    <span className="text-[10px] font-black tracking-[.08em]">GUIDE {index + 1}</span>
                    <strong className="mt-1 block break-keep text-sm leading-5 text-ink">{notice.title}</strong>
                    <span className="mt-2 block text-[10px]">{dateLabel(notice.updated_at)}</span>
                  </button>
                );
              })}
            </div>
          </nav>

          {selected && (
            <article className="min-w-0 p-4 sm:p-7 lg:p-9">
              <header className="border-b border-line pb-5">
                <p className="text-[10px] font-black tracking-[.12em] text-muted">NINETY-NINE NOTICE · {dateLabel(selected.updated_at)}</p>
                <h2 className="mt-3 break-keep text-xl font-black leading-8 tracking-[-.04em] sm:text-2xl">{selected.title}</h2>
              </header>
              <div className="whitespace-pre-wrap break-keep py-6 text-sm leading-7 text-ink">{selected.body}</div>
              {selected.image_paths.length > 0 && (
                <section className="space-y-5 border-t border-line pt-6">
                  <h3 className="text-sm font-black">사진으로 따라하기</h3>
                  {selected.image_paths.map((path, index) => {
                    const caption = GUIDE_IMAGE_CAPTIONS[path] ?? `${index + 1}단계 화면`;
                    return (
                      <figure className="overflow-hidden rounded-2xl border-4 border-red-500 bg-surface p-2 shadow-sm" key={path}>
                        <Image alt={caption} className="h-auto w-full rounded-xl" height={900} priority={index === 0} sizes="(max-width: 1024px) 100vw, 760px" src={path} width={1440} />
                        <figcaption className="px-2 py-3 text-xs font-bold leading-5 text-red-700">
                          <span className="mr-2 inline-grid size-6 place-items-center rounded-full bg-red-600 text-[10px] text-white">{index + 1}</span>
                          {caption}
                        </figcaption>
                      </figure>
                    );
                  })}
                </section>
              )}
            </article>
          )}
        </div>
      )}
    </div>
  );
}
