"use client";

import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  GripVertical,
  ImagePlus,
  Save,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { compressProductImageForUpload } from "@/lib/images/productImageCompression";
import {
  DEFAULT_PLATFORM_CONFIG,
  parsePlatformConfig,
  type PlatformBanner,
  type PlatformConfig,
} from "@/lib/platform/config";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { invalidatePlatformConfig } from "@/hooks/usePlatformConfig";

const SECTION_LABELS: Record<string, string> = {
  archiveShop: "아카이브 숍",
  centerMall: "센터몰",
  featuredAuction: "추천 라이브 경매",
};

const won = (amount: number) =>
  `${new Intl.NumberFormat("ko-KR").format(amount)}원`;

export function OwnerSiteAdministration() {
  const { session } = useSupabaseSession();
  const token = session?.access_token ?? null;
  const fileInput = useRef<HTMLInputElement>(null);
  const [config, setConfig] = useState<PlatformConfig>(DEFAULT_PLATFORM_CONFIG);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [reason, setReason] = useState("소유자센터 플랫폼 콘텐츠 정기 변경");
  const [draggedBannerId, setDraggedBannerId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const response = await fetch("/api/admin/owner/platform", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = (await response.json()) as {
      config?: unknown;
      error?: string;
    };
    if (!response.ok || !payload.config) {
      throw new Error(payload.error ?? "플랫폼 콘텐츠를 불러오지 못했습니다.");
    }
    setConfig(parsePlatformConfig(payload.config));
  }, [token]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load().catch((error: unknown) =>
        setNotice(
          error instanceof Error
            ? error.message
            : "플랫폼 콘텐츠를 불러오지 못했습니다.",
        ),
      );
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const enabledBannerCount = useMemo(
    () => config.banners.filter((banner) => banner.enabled).length,
    [config.banners],
  );

  const updateBanner = (id: string, patch: Partial<PlatformBanner>) => {
    setConfig((current) => ({
      ...current,
      banners: current.banners.map((banner) =>
        banner.id === id ? { ...banner, ...patch } : banner,
      ),
    }));
  };

  const moveBanner = (index: number, direction: -1 | 1) => {
    setConfig((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.banners.length) return current;
      const banners = [...current.banners];
      [banners[index], banners[target]] = [banners[target], banners[index]];
      return { ...current, banners };
    });
  };

  const moveBannerTo = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setConfig((current) => {
      const sourceIndex = current.banners.findIndex((banner) => banner.id === sourceId);
      const targetIndex = current.banners.findIndex((banner) => banner.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const banners = [...current.banners];
      const [source] = banners.splice(sourceIndex, 1);
      banners.splice(targetIndex, 0, source);
      return { ...current, banners };
    });
  };

  const uploadBanner = async (file: File) => {
    setBusy(true);
    setNotice("");
    try {
      const compressed = await compressProductImageForUpload(file);
      const path = `banners/${crypto.randomUUID()}-${compressed.name.replace(/[^a-z0-9._-]/gi, "-")}`;
      const client = getSupabaseBrowserClient();
      const { data, error } = await client.storage
        .from("platform-content")
        .upload(path, compressed, {
          cacheControl: "31536000",
          contentType: compressed.type,
        });
      if (error || !data) throw new Error("배너 업로드에 실패했습니다.");
      const imageUrl = client.storage
        .from("platform-content")
        .getPublicUrl(data.path).data.publicUrl;
      setConfig((current) => ({
        ...current,
        banners: [
          ...current.banners,
          {
            enabled: true,
            id: crypto.randomUUID(),
            imageUrl,
            title: file.name.replace(/\.[^.]+$/, "").slice(0, 80),
          },
        ],
      }));
      setNotice(
        `배너를 ${(file.size / 1024).toFixed(0)}KB에서 ${(compressed.size / 1024).toFixed(0)}KB로 압축해 업로드했습니다. 저장 버튼을 눌러 반영해 주세요.`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "배너 업로드에 실패했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!token || reason.trim().length < 3) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/owner/platform", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "save_platform_config",
          banners: config.banners,
          expectedVersion: config.version,
          globalDeliveryFee: config.globalDeliveryFee,
          homeSections: config.homeSections,
          policyMarkdown: config.policyMarkdown,
          reason: reason.trim(),
          storageDurationDays: config.storageDurationDays,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        if (response.status === 409) await load();
        throw new Error(payload.error ?? "플랫폼 설정을 저장하지 못했습니다.");
      }
      invalidatePlatformConfig();
      await load();
      setNotice("메인 노출·배너·플랫폼 정책 설정을 반영했습니다.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "플랫폼 설정을 저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-8 space-y-6 overflow-x-hidden rounded-3xl border border-zinc-800 bg-zinc-950 p-4 text-zinc-100 sm:p-6">
      <header>
        <p className="text-[10px] font-black tracking-[.16em] text-amber-400">
          OWNER SITE ADMINISTRATION
        </p>
        <h1 className="mt-2 text-2xl font-black">메인 화면·플랫폼 콘텐츠</h1>
        <p className="mt-2 text-xs leading-5 text-zinc-400">
          메인 노출 순서와 고객 안내 정책을 배포 없이 변경합니다.
        </p>
      </header>

      {notice ? (
        <p aria-live="polite" className="rounded-xl border border-zinc-700 p-3 text-xs">
          {notice}
        </p>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <article className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
          <h2 className="font-black">메인 섹션 노출</h2>
          <div className="mt-4 space-y-2">
            {Object.entries(config.homeSections).map(([key, enabled]) => (
              <div className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-zinc-700 px-3" key={key}>
                <span className="text-xs font-bold">{SECTION_LABELS[key] ?? key}</span>
                <button
                  aria-label={`${SECTION_LABELS[key] ?? key} ${enabled ? "숨기기" : "표시"}`}
                  aria-pressed={enabled}
                  className={`grid min-h-11 min-w-11 place-items-center rounded-full ${enabled ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-400"}`}
                  onClick={() =>
                    setConfig((current) => ({
                      ...current,
                      homeSections: {
                        ...current.homeSections,
                        [key]: !enabled,
                      },
                    }))
                  }
                  type="button"
                >
                  {enabled ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-black">메인 배너 순서</h2>
              <p className="mt-1 text-[10px] text-zinc-500">노출 {enabledBannerCount}개 · 최대 20개</p>
            </div>
            <button
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-500 px-4 text-xs font-black text-zinc-950 disabled:opacity-40"
              disabled={busy || config.banners.length >= 20}
              onClick={() => fileInput.current?.click()}
              type="button"
            >
              <ImagePlus size={16} /> 배너 추가
            </button>
            <input
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadBanner(file);
                event.target.value = "";
              }}
              ref={fileInput}
              type="file"
            />
          </div>
          <div className="mt-4 space-y-3">
            {config.banners.map((banner, index) => (
              <div
                className={`grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-3 rounded-xl border p-3 transition md:cursor-grab md:active:cursor-grabbing ${draggedBannerId === banner.id ? "border-amber-400 opacity-60" : "border-zinc-700"}`}
                draggable
                key={banner.id}
                onDragEnd={() => setDraggedBannerId(null)}
                onDragOver={(event) => event.preventDefault()}
                onDragStart={() => setDraggedBannerId(banner.id)}
                onDrop={() => {
                  if (draggedBannerId) moveBannerTo(draggedBannerId, banner.id);
                  setDraggedBannerId(null);
                }}
              >
                <div className="relative">
                  <CatalogImage alt="" className="aspect-video w-[72px] rounded-lg object-cover" height={45} src={banner.imageUrl} width={72} />
                  <span aria-hidden="true" className="absolute -bottom-1 -right-1 hidden rounded-md bg-zinc-950 p-1 text-zinc-400 md:block"><GripVertical size={14} /></span>
                </div>
                <div className="min-w-0">
                  <input
                    aria-label={`${index + 1}번째 배너 제목`}
                    className="h-10 w-full min-w-0 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs"
                    maxLength={80}
                    onChange={(event) => updateBanner(banner.id, { title: event.target.value })}
                    value={banner.title}
                  />
                  <div className="mt-2 flex flex-wrap gap-1">
                    <button aria-label={`${banner.title} 위로 이동`} className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-zinc-700 disabled:opacity-30" disabled={index === 0} onClick={() => moveBanner(index, -1)} type="button"><ArrowUp size={16} /></button>
                    <button aria-label={`${banner.title} 아래로 이동`} className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-zinc-700 disabled:opacity-30" disabled={index === config.banners.length - 1} onClick={() => moveBanner(index, 1)} type="button"><ArrowDown size={16} /></button>
                    <button aria-label={`${banner.title} 노출 전환`} aria-pressed={banner.enabled} className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-zinc-700" onClick={() => updateBanner(banner.id, { enabled: !banner.enabled })} type="button">{banner.enabled ? <Eye size={16} /> : <EyeOff size={16} />}</button>
                    <button aria-label={`${banner.title} 삭제`} className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-rose-500/40 text-rose-400" onClick={() => setConfig((current) => ({ ...current, banners: current.banners.filter((item) => item.id !== banner.id) }))} type="button"><Trash2 size={16} /></button>
                  </div>
                </div>
              </div>
            ))}
            {config.banners.length === 0 ? <p className="rounded-xl border border-dashed border-zinc-700 py-8 text-center text-xs text-zinc-500">등록된 운영 배너가 없습니다.</p> : null}
          </div>
        </article>
      </div>

      <article className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
        <h2 className="font-black">배송·보관 기본 정책</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-bold">기본 배송비
            <input className="mt-2 h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3" inputMode="numeric" min={0} onChange={(event) => setConfig((current) => ({ ...current, globalDeliveryFee: Number(event.target.value) }))} pattern="[0-9]*" type="number" value={config.globalDeliveryFee} />
            <span className="mt-1 block text-[10px] font-normal text-zinc-500">현재 {won(config.globalDeliveryFee)}</span>
          </label>
          <label className="text-xs font-bold">기본 무료 보관 기간
            <input className="mt-2 h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3" inputMode="numeric" min={1} onChange={(event) => setConfig((current) => ({ ...current, storageDurationDays: Number(event.target.value) }))} pattern="[0-9]*" type="number" value={config.storageDurationDays} />
            <span className="mt-1 block text-[10px] font-normal text-zinc-500">신규 기본 정책 {config.storageDurationDays}일</span>
          </label>
        </div>
      </article>

      <article className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-black">정책 Markdown</h2>
          <button aria-pressed={preview} className="min-h-11 rounded-xl border border-zinc-700 px-4 text-xs font-bold" onClick={() => setPreview((current) => !current)} type="button">{preview ? "편집" : "미리보기"}</button>
        </div>
        {preview ? (
          <div className="mt-4 min-h-48 whitespace-pre-wrap break-words rounded-xl border border-zinc-700 bg-zinc-950 p-4 text-sm leading-7">{config.policyMarkdown || "작성된 정책 안내가 없습니다."}</div>
        ) : (
          <textarea className="mt-4 min-h-56 w-full resize-y rounded-xl border border-zinc-700 bg-zinc-950 p-4 font-mono text-sm leading-6" maxLength={20000} onChange={(event) => setConfig((current) => ({ ...current, policyMarkdown: event.target.value }))} placeholder="# 배송 및 보관 정책" value={config.policyMarkdown} />
        )}
      </article>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="text-xs font-bold">변경 사유
          <input className="mt-2 h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3" maxLength={500} onChange={(event) => setReason(event.target.value)} value={reason} />
        </label>
        <button className="inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-xl bg-emerald-500 px-5 text-xs font-black text-zinc-950 disabled:opacity-40" disabled={busy || !token || reason.trim().length < 3} onClick={() => void save()} type="button"><Save size={16} /> {busy ? "저장 중…" : "전체 설정 저장"}</button>
      </div>
    </section>
  );
}
