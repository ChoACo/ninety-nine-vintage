"use client";
import { Cog, Heart, LogOut, Package, Truck, Gavel, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { logoutBrowserSession } from "@/lib/auth/logout";
import {
  clientErrorFromResponse,
  reportClientError,
} from "@/lib/clientErrors";
import { PremiumDialog } from "@/components/ui/PremiumDialog";
import { useCommerceStore } from "@/store/useCommerceStore";
import { ProfileAvatarUploader } from "@/components/features/mypage/ProfileAvatarUploader";
export type MyTab =
  "home" | "vault" | "auction" | "orders" | "wishlist" | "settings";
interface Metrics {
  vault: number;
  bids: number;
  wins: number;
  shipping: number;
  risk: boolean;
}
interface MemberProfile {
  avatar_url: string | null;
  display_name: string;
}
type MetricSource = "auction" | "orders" | "vault";

async function fetchMetricPayload(
  url: string,
  accessToken: string,
  fallback: string,
  signal: AbortSignal,
) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
  if (!response.ok) throw await clientErrorFromResponse(response, fallback);
  return response.json() as Promise<Record<string, unknown>>;
}

export function ProfileHeader({
  activeTab,
  onTabChange,
  basePath = "",
}: {
  activeTab: MyTab;
  onTabChange: (tab: MyTab) => void;
  basePath?: "" | "/m";
}) {
  const { session } = useSupabaseSession();
  const liked = useCommerceStore((s) => s.likedIds.length);
  const [metrics, setMetrics] = useState<Metrics>({
    vault: 0,
    bids: 0,
    wins: 0,
    shipping: 0,
    risk: false,
  });
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [metricFailures, setMetricFailures] = useState<MetricSource[]>([]);
  const [metricsRetryKey, setMetricsRetryKey] = useState(0);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const user = session?.user;
  const nickname =
    profile?.display_name ??
    user?.user_metadata?.nickname ??
    user?.user_metadata?.display_name ??
    user?.user_metadata?.name ??
    user?.user_metadata?.full_name ??
    user?.email?.split("@")[0] ??
    "회원";
  const email =
    user?.email?.replace(/^(.{2}).*(@.*)$/u, "$1**$2") ?? "카카오 회원";
  useEffect(() => {
    const accessToken = session?.access_token;
    if (!accessToken) return;
    let active = true;
    const controller = new AbortController();
    const requests = [
      {
        fallback: "보관함 요약을 불러오지 못했습니다.",
        key: "vault" as const,
        promise: fetchMetricPayload(
          "/api/account/storage",
          accessToken,
          "보관함 요약을 불러오지 못했습니다.",
          controller.signal,
        ),
      },
      {
        fallback: "입찰 요약을 불러오지 못했습니다.",
        key: "auction" as const,
        promise: fetchMetricPayload(
          "/api/account/bids",
          accessToken,
          "입찰 요약을 불러오지 못했습니다.",
          controller.signal,
        ),
      },
      {
        fallback: "배송 요약을 불러오지 못했습니다.",
        key: "orders" as const,
        promise: fetchMetricPayload(
          "/api/account/shipments",
          accessToken,
          "배송 요약을 불러오지 못했습니다.",
          controller.signal,
        ),
      },
    ];

    void Promise.allSettled(requests.map((request) => request.promise)).then(
      (results) => {
        if (!active) return;
        const failed = requests.flatMap((request, index) =>
          results[index]?.status === "rejected" ? [request.key] : [],
        );
        const [storage, bids, shipments] = results;
        setMetrics((current) => {
          const next = { ...current };
          if (storage.status === "fulfilled") {
            const items = Array.isArray(storage.value.items)
              ? (storage.value.items as Array<{
                  storageExpiresAt?: string | null;
                }>)
              : [];
            next.vault = items.length;
            next.risk = items.some((row) => {
              const days =
                (Date.parse(row.storageExpiresAt ?? "") - Date.now()) /
                86400000;
              return days >= 0 && days <= 3;
            });
          }
          if (bids.status === "fulfilled") {
            const summary =
              bids.value.summary && typeof bids.value.summary === "object"
                ? (bids.value.summary as Record<string, unknown>)
                : {};
            next.bids =
              Number(summary.leading ?? 0) + Number(summary.outbid ?? 0);
            next.wins = Number(summary.final ?? 0);
          }
          if (shipments.status === "fulfilled") {
            next.shipping = Array.isArray(shipments.value.shipments)
              ? shipments.value.shipments.filter(
                  (row) =>
                    !row ||
                    typeof row !== "object" ||
                    (row as { status?: string }).status !== "delivered",
                ).length
              : 0;
          }
          return next;
        });
        setMetricFailures(failed);
        results.forEach((result, index) => {
          if (result.status !== "rejected" || controller.signal.aborted) return;
          const request = requests[index];
          reportClientError(result.reason, {
            dedupeKey: `profile-metrics-${request.key}`,
            fallback: request.fallback,
          });
        });
      },
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [metricsRetryKey, session?.access_token]);
  useEffect(() => {
    if (!user?.id) return;
    const supabase = getSupabaseBrowserClient();
    let active = true;
    void supabase
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data) setProfile(data);
      });

    const channel = supabase
      .channel(`my-profile-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          const next = payload.new as Partial<MemberProfile>;
          if (typeof next.display_name !== "string") return;
          setProfile({
            avatar_url:
              typeof next.avatar_url === "string" ? next.avatar_url : null,
            display_name: next.display_name,
          });
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);
  const cards = [
    {
      tab: "vault" as const,
      label: "보관함",
      value: metricFailures.includes("vault") ? null : metrics.vault,
      Icon: Package,
      risk: !metricFailures.includes("vault") && metrics.risk,
    },
    {
      tab: "auction" as const,
      label: "참여 옥션",
      value: metricFailures.includes("auction")
        ? null
        : metrics.bids + metrics.wins,
      Icon: Gavel,
      risk: !metricFailures.includes("auction") && metrics.wins > 0,
    },
    {
      tab: "orders" as const,
      label: "주문/배송",
      value: metricFailures.includes("orders") ? null : metrics.shipping,
      Icon: Truck,
      risk: false,
    },
    {
      tab: "wishlist" as const,
      label: "찜 목록",
      value: liked,
      Icon: Heart,
      risk: false,
    },
  ];
  const logout = async () => {
    if (!session?.access_token || logoutBusy) return;
    setLogoutBusy(true);
    try {
      await logoutBrowserSession(session.access_token, basePath);
    } catch (error) {
      reportClientError(error, {
        dedupeKey: "profile-logout",
        fallback: "로그아웃을 완료하지 못했습니다.",
        userMessage: "로그아웃을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        visibility: "always",
      });
      setLogoutBusy(false);
    }
  };
  return (
    <>
      <header className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-100 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex items-center gap-4">
            <div className="relative">
              {user?.id ? (
                <ProfileAvatarUploader
                  currentAvatarUrl={
                    profile?.avatar_url ??
                    user.user_metadata?.avatar_url ??
                    null
                  }
                  nickname={String(nickname)}
                  onAvatarUpdated={(avatarUrl) =>
                    setProfile((current) => ({
                      avatar_url: avatarUrl,
                      display_name: current?.display_name ?? String(nickname),
                    }))
                  }
                  userId={user.id}
                />
              ) : (
                <div className="grid size-20 place-items-center rounded-full bg-zinc-800 text-2xl font-black">
                  {String(nickname).slice(0, 1)}
                </div>
              )}
              <span className="absolute -bottom-1 -right-1 translate-x-1 translate-y-1 rounded-full bg-kakao px-2 py-1 text-[8px] font-black text-kakao-foreground z-10">
                KAKAO
              </span>
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-[-.05em]">
                {nickname}
              </h1>
              <p className="mt-1 text-xs text-zinc-400">{email}</p>
              <p className="mt-1 font-mono text-[10px] text-zinc-500">
                MEMBER SINCE{" "}
                {user?.created_at
                  ? new Date(user.created_at).toLocaleDateString("ko-KR")
                  : "-"}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              aria-label="계정 설정"
              className="grid size-11 place-items-center rounded-xl border border-zinc-700"
              onClick={() => onTabChange("settings")}
              type="button"
            >
              <Cog size={17} />
            </button>
            <button
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-700 px-4 text-xs font-bold"
              onClick={() => setLogoutOpen(true)}
              type="button"
            >
              <LogOut size={15} />
              로그아웃
            </button>
          </div>
        </div>
        <div className="mt-7 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {cards.map(({ tab, label, value, Icon, risk }) => (
            <button
              aria-current={activeTab === tab ? "page" : undefined}
              className={`relative rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 ${activeTab === tab ? "border-amber-500 bg-zinc-900" : "border-zinc-800 bg-zinc-900/60"}`}
              key={tab}
              onClick={() => onTabChange(tab)}
              type="button"
            >
              <Icon size={18} />
              {risk ? (
                <span className="absolute right-3 top-3 size-2 animate-pulse rounded-full bg-rose-500" />
              ) : null}
              <p className="mt-5 text-[10px] text-zinc-400">{label}</p>
              <p className="mt-2 font-mono text-2xl font-black">
                {value ?? "—"}
              </p>
            </button>
          ))}
        </div>
        {metricFailures.length > 0 && (
          <div
            className="mt-3 flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs"
            role="alert"
          >
            <span>
              일부 계정 요약을 불러오지 못해 해당 항목을 —로 표시했습니다.
            </span>
            <button
              className="min-h-11 rounded-lg border border-amber-300/40 px-4 font-bold active:scale-[.98]"
              onClick={() => setMetricsRetryKey((current) => current + 1)}
              type="button"
            >
              다시 불러오기
            </button>
          </div>
        )}
      </header>
      <PremiumDialog
        closeDisabled={logoutBusy}
        labelledBy="my-logout-title"
        onClose={() => setLogoutOpen(false)}
        open={logoutOpen}
        panelClassName="max-w-md"
      >
        <div className="flex items-start justify-between border-b border-line p-5">
          <h2 className="text-xl font-black" id="my-logout-title">
            로그아웃하시겠습니까?
          </h2>
          <button
            aria-label="닫기"
            disabled={logoutBusy}
            onClick={() => setLogoutOpen(false)}
            type="button"
          >
            <X />
          </button>
        </div>
        <div className="p-5">
          <p className="text-sm text-muted">
            진행 중인 결제나 배송 신청 내용을 확인한 뒤 로그아웃해 주세요.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-2">
            <button
              className="min-h-11 border border-line font-bold"
              disabled={logoutBusy}
              onClick={() => setLogoutOpen(false)}
              type="button"
            >
              취소
            </button>
            <button
              className="min-h-11 bg-ink font-bold text-paper disabled:opacity-50"
              disabled={logoutBusy}
              onClick={() => void logout()}
              type="button"
            >
              {logoutBusy ? "로그아웃 중…" : "로그아웃"}
            </button>
          </div>
        </div>
      </PremiumDialog>
    </>
  );
}
