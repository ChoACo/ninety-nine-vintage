"use client";

import Image from "next/image";
import { ArrowLeft, BookOpen, Maximize2, Megaphone, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PremiumDialog } from "@/components/ui/PremiumDialog";
import { getGuideImageDimensions } from "@/lib/notices/guideImageDimensions";
import {
  GUIDE_IMAGE_CAPTIONS,
  type MemberGuideNotice,
} from "@/lib/notices/memberGuideNotices";

type NoticeCategory = "all" | "buyer" | "seller" | "notice";
type LightboxImage = { path: string; caption: string; step: number };

const NOTICE_CATEGORIES: ReadonlyArray<{
  id: NoticeCategory;
  label: string;
}> = [
  { id: "all", label: "전체" },
  { id: "buyer", label: "구매자 가이드" },
  { id: "seller", label: "판매자 가이드" },
  { id: "notice", label: "공지" },
];

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function noticeCategory(notice: MemberGuideNotice): Exclude<NoticeCategory, "all"> {
  if (notice.image_paths.some((path) => path.startsWith("/guides/buyer/"))) {
    return "buyer";
  }
  if (notice.image_paths.some((path) => path.startsWith("/guides/operator/"))) {
    return "seller";
  }
  return "notice";
}

function GuideImage({
  caption,
  index,
  onOpen,
  path,
}: {
  caption: string;
  index: number;
  onOpen: (image: LightboxImage) => void;
  path: string;
}) {
  const dimensions = getGuideImageDimensions(path);

  return (
    <figure className="rounded-2xl border border-line bg-surface p-2 shadow-sm">
      <button
        aria-label={`${caption} 크게 보기`}
        className="group relative block w-full overflow-hidden rounded-xl bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:scale-[.995]"
        onClick={() => onOpen({ path, caption, step: index + 1 })}
        type="button"
      >
        <Image
          alt={caption}
          className="mx-auto h-auto w-full max-w-lg object-contain"
          height={dimensions.height}
          sizes="(max-width: 640px) calc(100vw - 3rem), 512px"
          src={path}
          width={dimensions.width}
        />
        <span className="absolute right-3 top-3 grid size-11 place-items-center rounded-full bg-ink/85 text-paper shadow-lg backdrop-blur-sm transition-transform group-hover:scale-105">
          <Maximize2 aria-hidden="true" size={18} />
        </span>
      </button>
      <figcaption className="flex items-start gap-2 px-2 py-3 text-xs font-bold leading-5 text-ink">
        <span className="inline-flex min-h-7 shrink-0 items-center rounded-full bg-ink px-2.5 text-[10px] font-black tracking-[.04em] text-paper">
          Step {index + 1}
        </span>
        <span className="pt-1">{caption}</span>
      </figcaption>
    </figure>
  );
}

function NoticeArticle({
  notice,
  onImageOpen,
}: {
  notice: MemberGuideNotice;
  onImageOpen: (image: LightboxImage) => void;
}) {
  return (
    <article className="min-w-0 p-4 sm:p-7 lg:p-9">
      <header className="border-b border-line pb-5">
        <p className="text-[10px] font-black tracking-[.12em] text-muted">
          NINETY-NINE NOTICE · {dateLabel(notice.updated_at)}
        </p>
        <h2 className="mt-3 break-keep text-xl font-black leading-8 tracking-[-.04em] sm:text-2xl">
          {notice.title}
        </h2>
      </header>
      <div className="whitespace-pre-wrap break-keep py-6 text-sm leading-7 text-ink">
        {notice.body}
      </div>
      {notice.image_paths.length > 0 && (
        <section className="space-y-5 border-t border-line pt-6">
          <h3 className="text-sm font-black">사진으로 따라하기</h3>
          {notice.image_paths.map((path, index) => {
            const caption =
              GUIDE_IMAGE_CAPTIONS[path] ?? `${index + 1}단계 화면`;
            return (
              <GuideImage
                caption={caption}
                index={index}
                key={path}
                onOpen={onImageOpen}
                path={path}
              />
            );
          })}
        </section>
      )}
    </article>
  );
}

function NoticeList({
  notices,
  onSelect,
  selectedId,
}: {
  notices: MemberGuideNotice[];
  onSelect: (noticeId: string) => void;
  selectedId?: string | null;
}) {
  return (
    <nav aria-label="이용 가이드 목록" className="grid gap-2 p-2">
      {notices.map((notice, index) => {
        const active = selectedId === notice.id;
        return (
          <button
            aria-current={active ? "page" : undefined}
            className={`min-h-14 w-full rounded-2xl border p-4 text-left transition-colors active:scale-[.99] ${
              active
                ? "border-ink bg-paper text-ink"
                : "border-transparent text-muted hover:border-line hover:bg-paper/70"
            }`}
            key={notice.id}
            onClick={() => onSelect(notice.id)}
            type="button"
          >
            <span className="text-[10px] font-black tracking-[.08em]">
              GUIDE {index + 1}
            </span>
            <strong className="mt-1 block break-keep text-sm leading-5 text-ink">
              {notice.title}
            </strong>
            <span className="mt-2 block text-[10px]">
              {dateLabel(notice.updated_at)}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

export function MemberNoticeBoard() {
  const [notices, setNotices] = useState<MemberGuideNotice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileSelectedId, setMobileSelectedId] = useState<string | null>(null);
  const [category, setCategory] = useState<NoticeCategory>("all");
  const [lightboxImage, setLightboxImage] = useState<LightboxImage | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/notices", { cache: "no-store" });
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
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      window.clearTimeout(timeoutId);
    };
  }, [load]);

  const filteredNotices = useMemo(
    () =>
      category === "all"
        ? notices
        : notices.filter((notice) => noticeCategory(notice) === category),
    [category, notices],
  );
  const selected =
    notices.find((notice) => notice.id === selectedId) ?? notices[0] ?? null;
  const mobileSelected =
    filteredNotices.find((notice) => notice.id === mobileSelectedId) ?? null;

  const selectCategory = (nextCategory: NoticeCategory) => {
    setCategory(nextCategory);
    setMobileSelectedId(null);
    const firstMatch =
      nextCategory === "all"
        ? notices[0]
        : notices.find((notice) => noticeCategory(notice) === nextCategory);
    setSelectedId(firstMatch?.id ?? null);
  };

  return (
    <div
      className="mx-auto w-full max-w-6xl space-y-5 pb-28 sm:pb-12"
      data-testid="member-notice-board"
    >
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
        <div
          className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm font-bold text-red-800"
          role="alert"
        >
          <p>{message}</p>
          <button
            className="mt-3 min-h-11 rounded-xl border border-red-300 px-4 text-xs active:scale-[.98]"
            onClick={() => void load()}
            type="button"
          >
            다시 불러오기
          </button>
        </div>
      )}

      {!loading && notices.length > 0 && (
        <nav
          aria-label="공지 카테고리"
          className="flex flex-wrap gap-2 rounded-2xl border border-line bg-paper p-2 lg:hidden"
        >
          {NOTICE_CATEGORIES.map((item) => (
            <button
              aria-pressed={category === item.id}
              className={`min-h-11 rounded-full border px-4 text-xs font-black transition-colors active:scale-[.98] ${
                category === item.id
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-surface text-muted"
              }`}
              key={item.id}
              onClick={() => selectCategory(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>
      )}

      {loading ? (
        <div
          className="grid min-h-[360px] place-items-center rounded-3xl border border-line bg-paper text-sm text-muted"
          role="status"
        >
          공지사항을 불러오고 있습니다.
        </div>
      ) : notices.length === 0 ? (
        <div className="grid min-h-[360px] place-items-center rounded-3xl border border-line bg-paper p-6 text-center">
          <div>
            <BookOpen className="mx-auto text-muted" size={30} />
            <p className="mt-3 text-sm font-bold">
              등록된 이용 가이드가 없습니다.
            </p>
          </div>
        </div>
      ) : (
        <>
          <section className="overflow-hidden rounded-3xl border border-line bg-paper lg:hidden">
            {filteredNotices.length === 0 ? (
              <div className="grid min-h-52 place-items-center p-6 text-center text-sm font-bold text-muted">
                해당 카테고리에 등록된 공지가 없습니다.
              </div>
            ) : mobileSelected ? (
              <div>
                <div className="border-b border-line bg-surface p-2">
                  <button
                    className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-black active:scale-[.98]"
                    onClick={() => setMobileSelectedId(null)}
                    type="button"
                  >
                    <ArrowLeft aria-hidden="true" size={18} />
                    목록으로
                  </button>
                </div>
                <NoticeArticle
                  notice={mobileSelected}
                  onImageOpen={setLightboxImage}
                />
              </div>
            ) : (
              <NoticeList
                notices={filteredNotices}
                onSelect={setMobileSelectedId}
              />
            )}
          </section>

          <div className="hidden min-w-0 overflow-hidden rounded-3xl border border-line bg-paper lg:grid lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className="border-r border-line bg-surface">
              <NoticeList
                notices={notices}
                onSelect={setSelectedId}
                selectedId={selected?.id}
              />
            </div>
            {selected && (
              <NoticeArticle
                notice={selected}
                onImageOpen={setLightboxImage}
              />
            )}
          </div>
        </>
      )}

      <PremiumDialog
        ariaLabel="가이드 이미지 크게 보기"
        onClose={() => setLightboxImage(null)}
        open={lightboxImage !== null}
        panelClassName="max-w-5xl bg-ink p-3 text-paper sm:p-5"
        zIndexClassName="z-[160]"
      >
        {lightboxImage && (
          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="min-w-0 break-keep text-xs font-bold leading-5 sm:text-sm">
                Step {lightboxImage.step} · {lightboxImage.caption}
              </p>
              <button
                aria-label="확대 이미지 닫기"
                className="grid size-11 shrink-0 place-items-center rounded-full bg-paper/10 active:scale-[.98]"
                onClick={() => setLightboxImage(null)}
                type="button"
              >
                <X aria-hidden="true" size={20} />
              </button>
            </div>
            <Image
              alt={lightboxImage.caption}
              className="mx-auto h-auto max-h-[75dvh] w-auto max-w-full rounded-xl object-contain"
              height={getGuideImageDimensions(lightboxImage.path).height}
              sizes="(max-width: 1024px) calc(100vw - 2rem), 960px"
              src={lightboxImage.path}
              width={getGuideImageDimensions(lightboxImage.path).width}
            />
          </div>
        )}
      </PremiumDialog>
    </div>
  );
}
